import { z } from "zod";
import { logger } from "../../../lib/logger/logger";
import {
  llmErrorsTotal,
  llmRequestDurationSeconds,
  llmRequestsTotal,
  llmTokensTotal,
} from "../../../observability/metrics";

export type LLMOptions = {
  // Kept separate from inputText so user content can't override instructions.
  systemPrompt?: string;
  maxOutputTokens?: number;
  // Same seed + same input + same settings → (best effort) same output. Unset: provider picks a random one.
  seed?: number;
};

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

export type LLMResponse<T> = {
  // null when the model declined (safety block / refusal)
  data: T | null;
  blocked: boolean;
  // Model version that actually answered
  servedBy: string;
  usage: TokenUsage;
  latencyMs: number;
};

// What a model class returns; the base class adds latency.
export type LLMCallResult<T> = Omit<LLMResponse<T>, "latencyMs">;

// Values are what appears in logs and in the llm_errors_total{kind} label.
export const LLM_ERROR_KIND = {
  RATE_LIMIT: "rate_limit",
  AUTH: "auth",
  INVALID_REQUEST: "invalid_request",
  SERVER: "server",
  TIMEOUT: "timeout",
  INVALID_OUTPUT: "invalid_output",
  UNKNOWN: "unknown",
} as const;
export type LLMErrorKind = (typeof LLM_ERROR_KIND)[keyof typeof LLM_ERROR_KIND];
export const LLM_ERROR_KINDS: readonly LLMErrorKind[] = Object.values(LLM_ERROR_KIND);

// Thrown by model classes when the API call worked but the output is unusable
// (truncated, empty, or not matching the schema).
export class LLMOutputError extends Error {}

// The one error type callers see, whatever the provider.
export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    readonly provider: string,
    readonly model: string,
    readonly cause: unknown
  ) {
    super(`${provider} ${model} failed (${kind}): ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const LOG_LEVEL: Record<LLMErrorKind, "warn" | "error"> = {
  [LLM_ERROR_KIND.RATE_LIMIT]: "warn",
  [LLM_ERROR_KIND.SERVER]: "warn",
  [LLM_ERROR_KIND.TIMEOUT]: "warn",
  [LLM_ERROR_KIND.INVALID_OUTPUT]: "warn",
  [LLM_ERROR_KIND.AUTH]: "error",
  [LLM_ERROR_KIND.INVALID_REQUEST]: "error",
  [LLM_ERROR_KIND.UNKNOWN]: "error",
};

export abstract class LLMModel {
  // thinkingLevel is the user's choice. Which values are allowed, the default, and what each
  // means for the API are defined by each model class, since providers differ.
  constructor(
    readonly provider: string,
    readonly name: string,
    readonly thinkingLevel: string
  ) {
    // Export every error series at 0 from startup, so an alert like
    // increase(llm_errors_total{kind="rate_limit"}[5m]) > 0 fires on the very first error.
    for (const kind of LLM_ERROR_KINDS) llmErrorsTotal.inc({ provider, model: name, kind }, 0);
  }

  // For model classes: returns `value` (or `fallback` when omitted) if it's one of `allowed`.
  protected static checkThinkingLevel(model: string, value: string | undefined, allowed: readonly string[], fallback: string): string {
    const level = value ?? fallback;
    if (!allowed.includes(level)) {
      throw new Error(`Invalid thinking level "${level}" for ${model}. Use one of: ${allowed.join(", ")}`);
    }
    return level;
  }

  // --- Implemented by each model class -------------------------------------------------

  // Makes the provider call. Throw the provider's own errors unchanged so the checks below
  // can inspect them; throw LLMOutputError for unusable output.
  protected abstract callModel<T>(inputText: string, responseJSON: z.ZodType<T>, options: LLMOptions): Promise<LLMCallResult<T>>;

  // Is this an error response from the provider's API (as opposed to a bug or network failure)?
  protected abstract hasError(err: unknown): boolean;
  protected abstract hasReachedRateLimit(err: unknown): boolean;
  // API key/token missing, invalid, expired, or without permission.
  protected abstract hasTokenExpired(err: unknown): boolean;
  protected abstract hasInvalidRequest(err: unknown): boolean;
  protected abstract hasServerError(err: unknown): boolean;
  protected abstract hasTimedOut(err: unknown): boolean;
  // Extra fields for the error log line, e.g. HTTP status.
  protected errorDetails(_err: unknown): Record<string, unknown> {
    return {};
  }

  // --- Shared by all models: the call plus logging and metrics --------------------------

  // Returns output matching responseJSON, already validated against it. Throws LLMError on failure.
  async fetchLLMResponse<T>(inputText: string, responseJSON: z.ZodType<T>, options: LLMOptions = {}): Promise<LLMResponse<T>> {
    const start = performance.now();
    try {
      const result = await this.callModel(inputText, responseJSON, options);
      const latencyMs = Math.round(performance.now() - start);
      this.recordSuccess(result, latencyMs);
      return { ...result, latencyMs };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      const kind = this.classifyError(err);
      this.recordError(kind, err, latencyMs);
      throw new LLMError(kind, this.provider, this.name, err);
    }
  }

  private classifyError(err: unknown): LLMErrorKind {
    if (err instanceof LLMOutputError) return LLM_ERROR_KIND.INVALID_OUTPUT;
    if (this.hasTimedOut(err)) return LLM_ERROR_KIND.TIMEOUT;
    if (!this.hasError(err)) return LLM_ERROR_KIND.UNKNOWN;
    if (this.hasReachedRateLimit(err)) return LLM_ERROR_KIND.RATE_LIMIT;
    if (this.hasTokenExpired(err)) return LLM_ERROR_KIND.AUTH;
    if (this.hasServerError(err)) return LLM_ERROR_KIND.SERVER;
    if (this.hasInvalidRequest(err)) return LLM_ERROR_KIND.INVALID_REQUEST;
    return LLM_ERROR_KIND.UNKNOWN;
  }

  private recordSuccess(result: LLMCallResult<unknown>, latencyMs: number) {
    const labels = { provider: this.provider, model: this.name };
    const outcome = result.blocked ? "blocked" : "success";
    llmRequestsTotal.inc({ ...labels, outcome });
    llmRequestDurationSeconds.observe({ ...labels, outcome }, latencyMs / 1000);
    llmTokensTotal.inc({ ...labels, direction: "input" }, result.usage.inputTokens);
    llmTokensTotal.inc({ ...labels, direction: "output" }, result.usage.outputTokens);

    if (result.blocked) {
      logger.warn({ ...labels, servedBy: result.servedBy, latencyMs }, "LLM call blocked by provider safety filter");
    }
  }

  private recordError(kind: LLMErrorKind, err: unknown, latencyMs: number) {
    const labels = { provider: this.provider, model: this.name };
    llmRequestsTotal.inc({ ...labels, outcome: "error" });
    llmRequestDurationSeconds.observe({ ...labels, outcome: "error" }, latencyMs / 1000);
    llmErrorsTotal.inc({ ...labels, kind });

    logger[LOG_LEVEL[kind]](
      {
        ...labels,
        kind,
        latencyMs,
        ...this.errorDetails(err),
        message: err instanceof Error ? err.message : String(err),
      },
      "LLM call failed"
    );
  }
}
