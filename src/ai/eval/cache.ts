// LLM output cache for the eval: if an output already exists for a key, it's reused instead of
// calling the model again. Every new output is appended as soon as it arrives, so nothing is lost.
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { TaggingRun } from "../post-tagging/tagger";

const CACHE_PATH = path.join("src", "ai", "eval", "results", "cache.jsonl");

// Everything that can change the model's output for one case.
export type CacheKeyParts = {
  model: string;
  thinkingLevel: string;
  seed: number;
  promptHash: string;
  schemaHash: string;
  // Eval case qId (e.g. "E01")
  caseId: string;
};

type CacheEntry = { key: string; parts: CacheKeyParts; savedAt: string; run: TaggingRun };

export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

export function cacheKey(parts: CacheKeyParts): string {
  const { model, thinkingLevel, seed, promptHash, schemaHash, caseId } = parts;
  return [model, thinkingLevel, `seed${seed}`, promptHash, schemaHash, caseId].join("|");
}

export class OutputCache {
  private readonly entries = new Map<string, TaggingRun>();

  constructor(private readonly file: string = CACHE_PATH) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry: CacheEntry = JSON.parse(line);
        this.entries.set(entry.key, entry.run);
      } catch {
        // a line cut off by a crash mid-write; skip it
      }
    }
  }

  get(parts: CacheKeyParts): TaggingRun | undefined {
    return this.entries.get(cacheKey(parts));
  }

  set(parts: CacheKeyParts, run: TaggingRun): void {
    const key = cacheKey(parts);
    this.entries.set(key, run);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const entry: CacheEntry = { key, parts, savedAt: new Date().toISOString(), run };
    fs.appendFileSync(this.file, JSON.stringify(entry) + "\n");
  }
}
