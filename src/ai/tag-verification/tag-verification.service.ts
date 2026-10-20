import { z } from "zod";
import { optional, numberEnv } from "../../config/env-utils";
import { shortHash } from "../../lib/commonutils";
import { createLLMModel, DEFAULT_MODEL } from "../llm/model.factory";
import { LLMError, LLMModel } from "../llm/models/llm-model";
import { LLMLogRepository } from "../logging/llm-log.repository";
import type { TagType, Universe } from "../../types/custom-types";
import { TAG_VERIFICATION_PROMPT, TAG_VERIFICATION_PROMPT_VERSION } from "./tag-verification.prompt";

const TASK = "tag_verification";

export type TagVerificationConfig = {
  model: string;
  // Model-specific (e.g. Gemini: low | medium | high).
  thinkingLevel: string;
  timeoutMs: number;
};

export function loadTagVerificationConfig(): TagVerificationConfig {
  return {
    model: optional("TAG_VERIFICATION_MODEL", DEFAULT_MODEL),
    thinkingLevel: optional("TAG_VERIFICATION_THINKING_LEVEL", "low"),
    timeoutMs: numberEnv("TAG_VERIFICATION_TIMEOUT_MS", 30_000),
  };
}

// A name the tagger found that isn't in the vocabulary, with its nearest vocabulary tags
// (from vector search).
export type NameToVerify = {
  name: { type: TagType; label: string; universe: Universe };
  candidates: { tagId: string; label: string; score: number }[];
};

// The LLM's 0/1 per candidate; undefined when it gave none (or contradicted itself).
export type CandidateAnswer = { tagId: string; label: string; score: number; same?: 0 | 1 };

// match:           exactly one candidate got a 1
// not_in_universe: not an HP/GOT entity at all (e.g. Frodo); the caller drops it
// review:          no 1s, several 1s, contradictory answer, or the LLM call failed
export type Verification =
  | { decision: "match"; tagId: string; tagLabel: string; answers: CandidateAnswer[] }
  | { decision: "not_in_universe"; answers: CandidateAnswer[] }
  | { decision: "review"; reason: "no_match" | "several_matches" | "contradictory" | "llm_failed"; answers: CandidateAnswer[] };

const VerificationSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().describe("The name id, e.g. 'n1'"),
      not_in_universe: z.boolean().describe("true if the name is not an HP or GOT entity at all"),
      answers: z.array(
        z.object({
          id: z.string().describe("The candidate id, e.g. 'c1'"),
          same: z.number().int().min(0).max(1).describe("1 if the name is exactly this entity, else 0"),
        })
      ),
    })
  ),
});

// Asks the LLM, for names that aren't in the vocabulary, which nearest tag (if any) each one is.
// One call covers all the names from a post. Logging, metrics and the llm_logging record are
// handled by the LLM base model.
export class TagVerificationService {
  private readonly llm: LLMModel;
  private readonly prompt = { version: TAG_VERIFICATION_PROMPT_VERSION, hash: shortHash(TAG_VERIFICATION_PROMPT) };

  constructor(
    llmLogRepo: LLMLogRepository,
    private readonly config: TagVerificationConfig = loadTagVerificationConfig(),
    llm?: LLMModel
  ) {
    this.llm = llm ?? createLLMModel(config.model, config.thinkingLevel, llmLogRepo);
  }

  // One result per name, in the same order. Never throws for LLM failures: those names come
  // back as "review", so nothing is guessed.
  async verify(items: NameToVerify[], context: { postText: string; postId?: string; requestId?: string }): Promise<Verification[]> {
    if (!items.length) return [];

    const names = items.map((it, i) => ({
      id: `n${i + 1}`,
      name: it.name.label,
      type: it.name.type,
      universe: it.name.universe,
      candidates: it.candidates.map((c, j) => ({ id: `c${j + 1}`, name: c.label })),
    }));
    const input = `<names>\n${JSON.stringify(names, null, 1)}\n</names>\n<post>\n${context.postText}\n</post>`;

    let data: z.infer<typeof VerificationSchema> | null = null;
    try {
      const response = await this.llm.fetchLLMResponse(input, VerificationSchema, {
        systemPrompt: TAG_VERIFICATION_PROMPT,
        timeoutMs: this.config.timeoutMs,
        task: TASK,
        context: { postId: context.postId, requestId: context.requestId, prompt: this.prompt },
      });
      data = response.data; // null when blocked
    } catch (err) {
      // Already logged and counted by the base model.
      if (!(err instanceof LLMError)) throw err;
    }

    return items.map((it, i) => {
      const result = data?.results.find((r) => r.id === `n${i + 1}`);
      const answers: CandidateAnswer[] = it.candidates.map((c, j) => {
        const given = result?.answers.filter((a) => a.id === `c${j + 1}`) ?? [];
        // A missing answer, or two different answers for one candidate, counts as no answer (never as a 1).
        const same = given.length && given.every((a) => a.same === given[0].same) ? (given[0].same as 0 | 1) : undefined;
        return { ...c, same };
      });
      return decide(result, answers);
    });
  }
}

function decide(result: { not_in_universe: boolean } | undefined, answers: CandidateAnswer[]): Verification {
  if (!result) return { decision: "review", reason: "llm_failed", answers };
  const ones = answers.filter((a) => a.same === 1);
  if (result.not_in_universe) {
    // "Not an HP/GOT entity" but also "this is Tyrion" can't both be true: let a reviewer decide.
    return ones.length ? { decision: "review", reason: "contradictory", answers } : { decision: "not_in_universe", answers };
  }
  if (ones.length === 1) return { decision: "match", tagId: ones[0].tagId, tagLabel: ones[0].label, answers };
  return { decision: "review", reason: ones.length ? "several_matches" : "no_match", answers };
}
