import { optional, numberEnv } from "../../config/env-utils";
import { GeminiEmbedder } from "./gemini.embedder";

// Turns texts into vectors; texts with similar meaning get nearby vectors.
export interface Embedder {
  // Stored next to each vector, so vectors from a different model can be found and re-embedded.
  readonly model: string;
  readonly dimensions: number;
  // One vector per text, in the same order. Throws if the call fails.
  embed(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

export function loadEmbeddingConfig() {
  return {
    model: optional("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
    // Must match numDimensions in the Atlas vector index (tag.repository.ts creates it with this value).
    dimensions: numberEnv("EMBEDDING_DIMENSIONS", 768),
    timeoutMs: numberEnv("EMBEDDING_TIMEOUT_MS", 30_000),
  };
}

// Returns undefined when LLM_API_KEY isn't set, so callers fall back to exact matching.
// To add a provider, add its class here and a branch on the model name.
export function createEmbedder(config = loadEmbeddingConfig()): Embedder | undefined {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return undefined;
  if (config.model.startsWith("gemini-")) return new GeminiEmbedder(config.model, config.dimensions, config.timeoutMs, apiKey);
  throw new Error(`Unsupported embedding model "${config.model}". Supported: gemini-*`);
}
