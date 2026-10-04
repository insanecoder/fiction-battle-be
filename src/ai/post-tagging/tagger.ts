import { LLMModel, TokenUsage } from "../llm/models/llm-model";
import { TaggingPrompt } from "./prompts";
import { PostTag, PostTagging, PostTaggingSchema } from "./tagging.schema";

const EMPTY_RESULT: PostTagging = { universe: [], confidence_in_universe: 0, tags: [] };

export type TaggingRun = {
  result: PostTagging;
  servedBy: string;
  refused: boolean;
  usage: TokenUsage;
  latencyMs: number;
};

// Tags one post with the given model + prompt. Throws LLMError on failure.
export async function tagPost(llm: LLMModel, prompt: TaggingPrompt, post: string, seed?: number): Promise<TaggingRun> {
  const text = post.trim();
  if (!text) {
    return { result: EMPTY_RESULT, servedBy: llm.name, refused: false, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, latencyMs: 0 };
  }

  const response = await llm.fetchLLMResponse(`<post>\n${text}\n</post>`, PostTaggingSchema, {
    systemPrompt: prompt.text,
    seed,
  });

  return {
    result: response.data ? normalize(response.data) : EMPTY_RESULT,
    servedBy: response.servedBy,
    refused: response.blocked,
    usage: response.usage,
    latencyMs: response.latencyMs,
  };
}

function normalize(result: PostTagging): PostTagging {
  const universe = [...new Set(result.universe)];

  const seen = new Set<string>();
  const tags: PostTag[] = [];
  for (const t of result.tags) {
    const tag = t.tag.trim();
    const key = `${t.type}|${t.universe}|${tag.toLowerCase()}`;
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push({ ...t, tag });
  }

  // A tag implies its universe, even if the model left it out of the list.
  for (const t of tags) {
    if (!universe.includes(t.universe)) universe.push(t.universe);
  }

  const confidence = Math.min(1, Math.max(0, result.confidence_in_universe));
  return { universe, confidence_in_universe: confidence, tags };
}
