import { createHash } from "crypto";

// 8 hex chars of SHA-256: a readable fingerprint for prompt, schema and config versions (not for security).
export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}
