import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel as GeminiThinkingLevel } from "@google/genai";
import { z } from "zod";
import { required } from "../../../config/env-utils";
import { LLMCallResult, LLMModel, LLMOptions, LLMOutputError } from "./llm-model";

// Thinking levels a caller can pass for Gemini, and the API value each one maps to.
export const GEMINI_THINKING_LEVELS = {
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
} as const;
export type GeminiThinkingLevelName = keyof typeof GEMINI_THINKING_LEVELS;
export const GEMINI_DEFAULT_THINKING_LEVEL: GeminiThinkingLevelName = "medium";

const BLOCKED_FINISH_REASONS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII
]);

export class GeminiModel extends LLMModel {
  private readonly client: GoogleGenAI;

  // thinkingLevel: low | medium | high (default medium)
  constructor(name: string, thinkingLevel?: string, apiKey: string = required("GEMINI_API_KEY")) {
    super(
      "gemini",
      name,
      LLMModel.checkThinkingLevel(name, thinkingLevel, Object.keys(GEMINI_THINKING_LEVELS), GEMINI_DEFAULT_THINKING_LEVEL)
    );
    this.client = new GoogleGenAI({
      apiKey,
      //  back off and retry instead of failing on 429.
      // Errors reach the base class only after these retries are used up.
      httpOptions: { retryOptions: { attempts: 5, initialDelay: 2, maxDelay: 30, httpStatusCodes: [429, 500, 503] } },
    });
  }

  protected async callModel<T>(inputText: string, responseJSON: z.ZodType<T>, options: LLMOptions): Promise<LLMCallResult<T>> {
    // $schema is metadata Gemini doesn't need.
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(responseJSON);

    const response = await this.client.models.generateContent({
      model: this.name,
      contents: inputText,
      config: {
        ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
        thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVELS[this.thinkingLevel as GeminiThinkingLevelName] },
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
      },
    });

    const usage = {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output on paid tiers, so count them here too.
      outputTokens: (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0),
      cacheReadTokens: response.usageMetadata?.cachedContentTokenCount ?? 0,
    };
    const servedBy = response.modelVersion ?? this.name;

    const finishReason = response.candidates?.[0]?.finishReason;
    if (response.promptFeedback?.blockReason || BLOCKED_FINISH_REASONS.has(finishReason)) {
      return { data: null, blocked: true, servedBy, usage };
    }
    if (finishReason === FinishReason.MAX_TOKENS) {
      throw new LLMOutputError("Hit max output tokens before finishing");
    }

    const text = response.text;
    if (!text) throw new LLMOutputError("Returned no text");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LLMOutputError("Returned invalid JSON");
    }
    const parsed = responseJSON.safeParse(json);
    if (!parsed.success) throw new LLMOutputError(`Output did not match schema: ${parsed.error.message}`);

    return { data: parsed.data, blocked: false, servedBy, usage };
  }

  // --- Error checks used by the base class for logging and metrics ---

  protected hasError(err: unknown): err is ApiError {
    return err instanceof ApiError;
  }

  // 429 RESOURCE_EXHAUSTED: per-minute/per-day limit or free-tier quota.
  protected hasReachedRateLimit(err: unknown): boolean {
    return this.hasError(err) && err.status === 429;
  }

  // Gemini reports invalid/expired API keys as 400 with an "API key" message, others as 401/403.
  protected hasTokenExpired(err: unknown): boolean {
    if (!this.hasError(err)) return false;
    return err.status === 401 || err.status === 403 || (err.status === 400 && /api[ _-]?key/i.test(err.message));
  }

  protected hasInvalidRequest(err: unknown): boolean {
    return this.hasError(err) && err.status >= 400 && err.status < 500;
  }

  protected hasServerError(err: unknown): boolean {
    return this.hasError(err) && err.status >= 500;
  }

  // Timeouts and network failures (the request never got an API response).
  protected hasTimedOut(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      (err.name === "TypeError" && /fetch failed/i.test(err.message))
    );
  }

  protected errorDetails(err: unknown): Record<string, unknown> {
    return this.hasError(err) ? { status: err.status } : {};
  }
}
