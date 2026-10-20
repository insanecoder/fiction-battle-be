import { ApiError, GoogleGenAI } from "@google/genai";
import { logger } from "../../lib/logger/logger";
import type { Embedder } from "./embedder";

// Gemini's embedContent accepts up to 100 texts per request.
const MAX_BATCH = 100;
// On 429, wait as long as the API asks (the free tier allows 100 texts per minute) and retry.
const RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_WAIT_S = 60;

// "Please retry in 42.12s" / RetryInfo "42s" → seconds to wait.
function retryAfterSeconds(err: ApiError): number {
  const match = /retry(?:Delay"?:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i.exec(err.message);
  return match ? Math.ceil(Number(match[1])) + 1 : DEFAULT_RATE_LIMIT_WAIT_S;
}

export class GeminiEmbedder implements Embedder {
  private readonly client: GoogleGenAI;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    timeoutMs: number,
    apiKey: string
  ) {
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        // Per attempt: each retry gets a fresh deadline (a shared AbortSignal would also cancel the retries).
        timeout: timeoutMs,
        // Server errors retry here; 429s are handled in embed(), which waits as long as the API asks.
        retryOptions: { attempts: 5, initialDelay: 2, maxDelay: 30, httpStatusCodes: [408, 500, 503] },
      },
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const response = await this.embedBatch(batch);
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length || embeddings.some((e) => !e.values?.length)) {
        throw new Error(`${this.model} returned ${embeddings.length} embeddings for ${batch.length} texts`);
      }
      vectors.push(...embeddings.map((e) => e.values!));
    }
    return vectors;
  }

  private async embedBatch(batch: string[], attempt = 0): ReturnType<GoogleGenAI["models"]["embedContent"]> {
    try {
      return await this.client.models.embedContent({
        model: this.model,
        contents: batch,
        config: {
          // Tag labels are compared with tag labels (not queries with documents), so both sides
          // use the symmetric task type.
          taskType: "SEMANTIC_SIMILARITY",
          outputDimensionality: this.dimensions,
        },
      });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429 || attempt >= RATE_LIMIT_RETRIES) throw err;
      const waitS = retryAfterSeconds(err);
      logger.warn({ model: this.model, waitS, texts: batch.length }, "Embedding rate limit hit; waiting before retrying");
      await new Promise((r) => setTimeout(r, waitS * 1000));
      return this.embedBatch(batch, attempt + 1);
    }
  }
}
