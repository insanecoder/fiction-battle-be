import { shortHash } from "../../../lib/commonutils";
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
  return { version, hash: shortHash(text), text };
}

export function listTaggingPromptVersions(): string[] {
  return Object.keys(PROMPTS);
}
