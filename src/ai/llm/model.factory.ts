import { LLMCallLogger, LLMModel } from "./models/llm-model";
import { GeminiModel } from "./models/gemini.model";

export const DEFAULT_MODEL = "gemini-3.5-flash";

// Returns the model object for a model name. thinkingLevel is passed through as given;
// each model class validates it against its own levels and applies its own default.
// callLogger (e.g. the llm_logging repository) records every call; omit it to skip the call log.
// To add a provider, add its class in models/ and a branch here.
export function createLLMModel(model: string = DEFAULT_MODEL, thinkingLevel?: string, callLogger?: LLMCallLogger): LLMModel {
  if (model.startsWith("gemini-")) return new GeminiModel(model, thinkingLevel, callLogger);
  throw new Error(`Unsupported model "${model}". Supported: gemini-*`);
}
