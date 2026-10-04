import { LLMModel } from "./models/llm-model";
import { GeminiModel } from "./models/gemini.model";

export const DEFAULT_MODEL = "gemini-3.5-flash";

// Returns the model object for a model name. thinkingLevel is passed through as given;
// each model class validates it against its own levels and applies its own default.
// To add a provider, add its class in models/ and a branch here.
export function createLLMModel(model: string = DEFAULT_MODEL, thinkingLevel?: string): LLMModel {
  if (model.startsWith("gemini-")) return new GeminiModel(model, thinkingLevel);
  throw new Error(`Unsupported model "${model}". Supported: gemini-*`);
}
