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

  get enabled(): boolean {
    return Boolean(this.llm);
  }

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
    void this.tag(request).catch(async (err) => {
      logger.error(
        { task: TASK, postId: request.postId, message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
        "Post tagging failed"
      );
      // Best effort, so the author sees a failure instead of "pending" forever.
      await this.postRepo.markTaggingFailed(request.postId, "TAGGING_FAILED").catch(() => {});
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
      if (err instanceof LLMError) {
        await this.postRepo.markTaggingFailed(postId, "TAGGING_FAILED");
        return;
      }
      throw err;
    }
    if (run.refused) {
      // logged as "blocked" by the base model
      await this.postRepo.markTaggingFailed(postId, "CONTENT_BLOCKED");
      return;
    }

    // Put the tags on the post, which makes them available to filters.
    const applied = await this.applyToPost(postId, run.result);
    if (run.logId) await this.llmLogRepo.recordApplied(run.logId, applied);
  }

  private async applyToPost(postId: string, result: PostTagging): Promise<{ tagCount: number; universe?: string[]; skippedReason?: string }> {
    if (result.confidence_in_universe < this.config.minUniverseConfidence) {
      await this.postRepo.markTaggingFailed(postId, "LOW_CONFIDENCE");
      return { tagCount: 0, skippedReason: `confidence ${result.confidence_in_universe} < ${this.config.minUniverseConfidence}` };
    }
    // normalize() adds each tag's universe to the list, so no universe also means no tags.
    if (!result.universe.length) {
      await this.postRepo.markTaggingFailed(postId, "NO_UNIVERSE");
      return { tagCount: 0, skippedReason: "no universe" };
    }

    // Crossover posts get both universes. They go on first and on their own, so a failure in the
    // tag step can't take them down too.
    const universe = result.universe;
    await this.postRepo.addUniverses(postId, universe);

    const rawTags = result.tags.map((t) => ({ type: t.type, label: t.tag, universe: t.universe }));
    let tagCount = 0;
    let skippedReason: string | undefined;
    if (rawTags.length) {
      try {
        const tagIds = await this.tagService.upsertTagsAndGetGroupedIds(rawTags);
        await this.postRepo.addAutoTags(postId, tagIds);
        tagCount = rawTags.length;
      } catch (err) {
        skippedReason = `tags not applied: ${err instanceof Error ? err.message : String(err)}`;
        logger.warn({ task: TASK, postId, message: skippedReason }, "Post tags not applied; universe kept");
      }
    }

    await this.postRepo.markTaggingFinished(postId, "NO_UNIVERSE");
    return { tagCount, universe, skippedReason };
  }
}
