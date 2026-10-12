import { optional, numberEnv } from "../../config/env-utils";
import { DEFAULT_MODEL } from "../llm/model.factory";

export type PostTaggingConfig = {
  enabled: boolean;
  model: string;
  // Model-specific (e.g. Gemini: low | medium | high). Unset uses the model's default.
  thinkingLevel?: string;
  promptVersion: string;
  seed?: number;
  // Calls over slowThresholdMs are reported as slow; at timeoutMs the call is aborted.
  slowThresholdMs: number;
  timeoutMs: number;
  // Below this confidence the result is logged but not applied to the post.
  minUniverseConfidence: number;
};

export function loadPostTaggingConfig(): PostTaggingConfig {
  const seed = process.env.TAGGING_SEED;
  return {
    enabled: optional("TAGGING_ENABLED", "true") === "true",
    model: optional("TAGGING_MODEL", DEFAULT_MODEL),
    thinkingLevel: process.env.TAGGING_THINKING_LEVEL || undefined,
    promptVersion: optional("TAGGING_PROMPT_VERSION", "1"),
    seed: seed ? Number(seed) : undefined,
    slowThresholdMs: numberEnv("TAGGING_SLOW_THRESHOLD_MS", 5_000),
    timeoutMs: numberEnv("TAGGING_TIMEOUT_MS", 30_000),
    minUniverseConfidence: numberEnv("TAGGING_MIN_CONFIDENCE", 0.6),
  };
}
