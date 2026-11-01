// The production tag resolution for the evals, read-only: TagService.resolveTags with save: false,
// and no review queueing. Needs the database (MONGO_URI) and, for vectors + verification, LLM_API_KEY.
import { MongooseAdapter } from "../../db/mongo-client";
import { TagRepository } from "../../features/tags/tag.repository";
import { TagMappingRepository } from "../../features/tags/tag-mapping.repository";
import { TagCandidateRepository } from "../../features/tags/tag-candidate.repository";
import { TagService, type ResolveTagsResult } from "../../features/tags/tag.service";
import { createEmbedder } from "../embeddings/embedder";
import { VectorSearchService } from "../vector-search/vector-search.service";
import { TagVerificationService } from "../tag-verification/tag-verification.service";
import type { LLMLogRepository } from "../logging/llm-log.repository";

export type EvalPipeline = {
  // vocabulary → map → vectors → verification, as for a live post
  tagService: TagService;
  // vocabulary and map only (no embedder or verification): for the expected labels
  lookupOnly: TagService;
  labelById: Map<string, string>;
  close(): Promise<void>;
};

// Verification calls from an eval aren't written to llm_logging.
const noCallLog = { start: async () => "", succeed: async () => {}, fail: async () => {} } as unknown as LLMLogRepository;

export async function createEvalPipeline(): Promise<EvalPipeline> {
  const mObj = new MongooseAdapter();
  const db = await mObj.connect("primary");
  const tagRepo = new TagRepository(db);
  const deps = { mappingRepo: new TagMappingRepository(db), candidateRepo: new TagCandidateRepository(db), vectorSearch: new VectorSearchService() };
  const verification = process.env.LLM_API_KEY ? new TagVerificationService(noCallLog) : undefined;
  return {
    tagService: new TagService(tagRepo, { ...deps, embedder: createEmbedder(), verification }),
    lookupOnly: new TagService(tagRepo, deps),
    labelById: new Map((await tagRepo.findAll()).map((t) => [String(t._id), t.label])),
    close: () => mObj.disconnect("primary"),
  };
}

// True when the post needed a verification call (some name reached step d).
export function usedVerification(r: ResolveTagsResult): boolean {
  return r.resolved.some((x) => x.how === "llm") || r.notInUniverse.length > 0 || r.toReview.some((t) => t.reason && t.reason !== "no_candidates");
}
