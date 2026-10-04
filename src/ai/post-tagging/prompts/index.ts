import { createHash } from "crypto";
import { V1 } from "./v1";

const PROMPTS: Record<string, string> = {
  "1": V1,
};

export type TaggingPrompt = {
  version: string;
  // Short hash of the text, recorded with eval results so an in-place edit is detectable.
  hash: string;
  text: string;
};

export function getTaggingPrompt(version: string): TaggingPrompt {
  const text = PROMPTS[version];
  if (!text) {
    throw new Error(`Unknown tagging prompt version "${version}". Known: ${listTaggingPromptVersions().join(", ")}`);
  }
  return { version, hash: createHash("sha256").update(text).digest("hex").slice(0, 8), text };
}

export function listTaggingPromptVersions(): string[] {
  return Object.keys(PROMPTS);
}
