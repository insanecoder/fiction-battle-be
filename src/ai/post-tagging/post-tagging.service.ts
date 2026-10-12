import { logger } from "../../lib/logger/logger";
import { createLLMModel } from "../llm/model.factory";
import { LLMError, LLMModel } from "../llm/models/llm-model";
import { LLMLogRepository } from "../logging/llm-log.repository";
import { PostsRepository } from "../../features/posts/posts.repository";
import { TagService } from "../../features/tags/tag.service";
import { getTaggingPrompt, TaggingPrompt } from "./prompts";
import { PostTagging } from "./tagging.schema";
import { tagPost } from "./tagger";
import { loadPostTaggingConfig, PostTaggingConfig } from "./post-tagging.config";

const TASK = "post_tagging";

export type TagPostRequest = { postId: string; content: string; requestId?: string };

// Tags a saved post with the LLM and applies the tags to the post.
// Logging, metrics and the llm_logging record for each call are handled by the LLM base model.
export class PostTaggingService {
  private readonly prompt: TaggingPrompt;
  // Undefined only when tagging is disabled by config.
  private readonly llm?: LLMModel;

  // Throws if tagging is enabled but the model can't be created (e.g. GEMINI_API_KEY missing),
  // so a misconfiguration fails at startup instead of being discovered later.
  constructor(
    private readonly llmLogRepo: LLMLogRepository,
    private readonly postRepo: PostsRepository,
    private readonly tagService: TagService,
    private readonly config: PostTaggingConfig = loadPostTaggingConfig(),
    llm?: LLMModel
  ) {
    this.prompt = getTaggingPrompt(config.promptVersion);
    if (!config.enabled) {
      logger.warn({ task: TASK }, "Post tagging is disabled (TAGGING_ENABLED=false)");
      return;
    }
    this.llm = llm ?? createLLMModel(config.model, config.thinkingLevel, llmLogRepo);
  }

  // Starts tagging without waiting for it, so creating a post stays fast. Nothing awaits this,
  // so any error that escapes tag() is logged here rather than becoming an unhandled rejection.
  // Runs inside this server process: if the process restarts mid-call, the log stays "pending".
  tagInBackground(request: TagPostRequest): void {
    void this.tag(request).catch((err) => {
      logger.error(
        { task: TASK, postId: request.postId, message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
        "Post tagging failed"
      );
    });
  }

  async tag({ postId, content, requestId }: TagPostRequest): Promise<void> {
    if (!this.llm) return; // disabled by config

    let run;
    try {
      run = await tagPost(this.llm, this.prompt, content, {
        seed: this.config.seed,
        timeoutMs: this.config.timeoutMs,
        slowThresholdMs: this.config.slowThresholdMs,
        task: TASK,
        context: { postId, requestId },
      });
    } catch (err) {
      // LLM failures (timeout, rate limit, bad output…) are already logged, counted and written
      // to llm_logging by the base model; the post just stays untagged. Anything else is a bug.
      if (err instanceof LLMError) return;
      throw err;
    }
    if (run.refused) return; // logged as "blocked" by the base model

    // Put the tags on the post, which makes them available to filters.
    const applied = await this.applyToPost(postId, run.result);
    if (run.logId) await this.llmLogRepo.recordApplied(run.logId, applied);
  }

  private async applyToPost(postId: string, result: PostTagging): Promise<{ tagCount: number; universe?: string; skippedReason?: string }> {
    if (result.confidence_in_universe < this.config.minUniverseConfidence) {
      return { tagCount: 0, skippedReason: `confidence ${result.confidence_in_universe} < ${this.config.minUniverseConfidence}` };
    }
    if (!result.tags.length && !result.universe.length) {
      return { tagCount: 0, skippedReason: "nothing to tag" };
    }

    const rawTags = result.tags.map((t) => ({ type: t.type, label: t.tag, universe: t.universe }));
    const tagIds = rawTags.length
      ? await this.tagService.upsertTagsAndGetGroupedIds(rawTags)
      : { person: [], place: [], artifact: [], event: [] };
    // A post has a single universe; crossover posts keep theirs unset (their tags carry both universes).
    const universe = result.universe.length === 1 ? result.universe[0] : undefined;

    await this.postRepo.applyAutoTags(postId, tagIds, universe);
    return { tagCount: rawTags.length, universe };
  }
}
