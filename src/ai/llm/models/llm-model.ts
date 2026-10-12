import { z } from "zod";
import { logger } from "../../../lib/logger/logger";
import { shortHash } from "../../../lib/commonutils";
import {
  llmErrorsTotal,
  llmLatencyEventsTotal,
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
  // Abort the call after this long and report it as "took too long". Unset: no limit.
  timeoutMs?: number;
  // Calls slower than this are reported as slow. Default DEFAULT_SLOW_THRESHOLD_MS.
  slowThresholdMs?: number;
  // What the call is for (e.g. "post_tagging"); added to log lines and the call log.
  task?: string;
  // Extra details stored with the call log.
  context?: LLMCallContext;
};

export type LLMCallContext = {
  postId?: string;
  requestId?: string;
  prompt?: { version: string; hash: string };
};

// --- Call log: every fetchLLMResponse() call is recorded here (e.g. the llm_logging collection) ---

export type LLMCallStart = {
  task: string;
  provider: string;
  model: string;
  inputText: string;
  schemaHash: string;
  params: { thinkingLevel: string; seed?: number; maxOutputTokens?: number; timeoutMs?: number };
  context: LLMCallContext;
};
export type LLMCallSuccess = {
  status: "success" | "blocked";
  servedBy: string;
  output: unknown;
  usage: TokenUsage;
  latencyMs: number;
  slow: boolean;
};
export type LLMCallFailure = { kind: LLMErrorKind; message: string; latencyMs: number };

export interface LLMCallLogger {
  // Before the call; returns the log id. If this throws, the LLM isn't called.
  start(call: LLMCallStart): Promise<string>;
  succeed(logId: string, result: LLMCallSuccess): Promise<void>;
  fail(logId: string, failure: LLMCallFailure): Promise<void>;
}

// What model classes receive: the caller's options plus the signal that enforces timeoutMs.
export type LLMCallOptions = LLMOptions & { abortSignal?: AbortSignal };

export const DEFAULT_SLOW_THRESHOLD_MS = 5_000;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

export type LLMResponse<T> = {
  // null when the model declined (safety block / refusal)
  data: T | null;
  blocked: boolean;
  // Model version that actually answered
  servedBy: string;
  usage: TokenUsage;
  latencyMs: number;
  // Id of this call in the call log, when the model has one
  logId?: string;
};

// What a model class returns; the base class adds latency and the log id.
export type LLMCallResult<T> = Omit<LLMResponse<T>, "latencyMs" | "logId">;

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
    readonly thinkingLevel: string,
    private readonly callLogger?: LLMCallLogger
  ) {
    // Export every error series at 0 from startup, so an alert like
    // increase(llm_errors_total{kind="rate_limit"}[5m]) > 0 fires on the very first error.
    for (const kind of LLM_ERROR_KINDS) llmErrorsTotal.inc({ provider, model: name, kind }, 0);
    for (const event of ["slow", "timeout"]) llmLatencyEventsTotal.inc({ provider, model: name, event }, 0);
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
  // Must pass options.abortSignal to the provider SDK so timeoutMs can cancel the request.
  protected abstract callModel<T>(inputText: string, responseJSON: z.ZodType<T>, options: LLMCallOptions): Promise<LLMCallResult<T>>;

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
    // 1. Call log before the call. If it can't be written, the error propagates and the LLM isn't called.
    const logId = await this.callLogger?.start({
      task: options.task ?? "unknown",
      provider: this.provider,
      model: this.name,
      inputText,
      schemaHash: shortHash(JSON.stringify(z.toJSONSchema(responseJSON))),
      params: { thinkingLevel: this.thinkingLevel, seed: options.seed, maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs },
      context: options.context ?? {},
    });

    // 2. The call itself, with the timeout.
    const controller = options.timeoutMs ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
    const start = performance.now();
    let result: LLMCallResult<T>;
    try {
      result = await this.callModel(inputText, responseJSON, { ...options, abortSignal: controller?.signal });
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      // Our own timeout fired: classify as timeout whatever error the SDK raised for the abort.
      const kind = controller?.signal.aborted ? LLM_ERROR_KIND.TIMEOUT : this.classifyError(err);
      const llmError = new LLMError(kind, this.provider, this.name, err);
      // 3a. Every failure (timeout or any other error) gets the same logging, metrics and call log.
      this.recordError(kind, err, latencyMs, options);
      if (logId !== undefined) await this.failCallLog(logId, llmError, latencyMs);
      throw llmError;
    } finally {
      clearTimeout(timer);
    }

    // 3b. Success: logging, metrics and call log.
    const latencyMs = Math.round(performance.now() - start);
    const slow = this.recordSuccess(result, latencyMs, options);
    if (logId !== undefined) {
      await this.callLogger!.succeed(logId, {
        status: result.blocked ? "blocked" : "success",
        servedBy: result.servedBy,
        output: result.data,
        usage: result.usage,
        latencyMs,
        slow,
      });
    }
    return { ...result, latencyMs, logId };
  }

  // Records the failure in the call log. If that write fails too, both errors are logged and the
  // original LLM error is thrown, so neither is lost.
  private async failCallLog(logId: string, llmError: LLMError, latencyMs: number): Promise<void> {
    try {
      await this.callLogger!.fail(logId, { kind: llmError.kind, message: llmError.message, latencyMs });
    } catch (logErr) {
      logger.error(
        { provider: this.provider, model: this.name, logId, kind: llmError.kind, message: logErr instanceof Error ? logErr.message : String(logErr) },
        "Could not write LLM failure to the call log"
      );
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

  // Returns whether the call counted as slow.
  private recordSuccess(result: LLMCallResult<unknown>, latencyMs: number, options: LLMOptions): boolean {
    const labels = { provider: this.provider, model: this.name };
    const outcome = result.blocked ? "blocked" : "success";
    llmRequestsTotal.inc({ ...labels, outcome });
    llmRequestDurationSeconds.observe({ ...labels, outcome }, latencyMs / 1000);
    llmTokensTotal.inc({ ...labels, direction: "input" }, result.usage.inputTokens);
    llmTokensTotal.inc({ ...labels, direction: "output" }, result.usage.outputTokens);

    if (result.blocked) {
      logger.warn({ ...labels, servedBy: result.servedBy, latencyMs }, "LLM call blocked by provider safety filter");
    }

    const slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
    if (latencyMs > slowThresholdMs) {
      llmLatencyEventsTotal.inc({ ...labels, event: "slow" });
      logger.warn({ ...labels, task: options.task, latencyMs, slowThresholdMs }, "LLM call was slow");
      return true;
    }
    return false;
  }

  private recordError(kind: LLMErrorKind, err: unknown, latencyMs: number, options: LLMOptions) {
    const labels = { provider: this.provider, model: this.name };
    llmRequestsTotal.inc({ ...labels, outcome: "error" });
    llmRequestDurationSeconds.observe({ ...labels, outcome: "error" }, latencyMs / 1000);
    llmErrorsTotal.inc({ ...labels, kind });

    // Same failure log line for every kind, timeouts included…
    logger[LOG_LEVEL[kind]](
      {
        ...labels,
        kind,
        task: options.task,
        latencyMs,
        ...this.errorDetails(err),
        message: err instanceof Error ? err.message : String(err),
      },
      "LLM call failed"
    );

    // …plus the dedicated "took too long" event for timeouts.
    if (kind === LLM_ERROR_KIND.TIMEOUT) {
      llmLatencyEventsTotal.inc({ ...labels, event: "timeout" });
      logger.error({ ...labels, task: options.task, latencyMs, timeoutMs: options.timeoutMs }, "LLM took too long to respond");
    }
  }
}
