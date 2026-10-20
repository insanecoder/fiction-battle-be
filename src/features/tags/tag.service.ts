import { TagRepository } from "./tag.repository";
import { TagMappingRepository } from "./tag-mapping.repository";
import { TagCandidateRepository } from "./tag-candidate.repository";
import { TagDocument, TAG_VECTOR_INDEX } from "../../models/tag.model";
import { tagNameKey } from "../../models/tag-mapping.model";
import { numberEnv } from "../../config/env-utils";
import { logger } from "../../lib/logger/logger";
import { tagResolutionsTotal, tagReviewQueueNewEntriesTotal } from "../../observability/metrics";
import type { Embedder } from "../../ai/embeddings/embedder";
import { VectorSearchService } from "../../ai/vector-search/vector-search.service";
import { TagVerificationService, type CandidateAnswer } from "../../ai/tag-verification/tag-verification.service";
import type { TagType, Universe } from "../../types/custom-types";

type TagInput = { type: TagType; label: string; universe: Universe };
type GroupedTagIds = { person: string[]; place: string[]; artifact: string[]; event: string[] };

export type TagName = { type: TagType; label: string; universe: Universe };

// vocabulary: the label is a vocabulary tag; map: seen before (tag_mappings);
// llm: vector search + the verification LLM picked exactly one tag.
export type ResolvedTag = { name: TagName; tagId: string; tagLabel: string; how: "vocabulary" | "map" | "llm" };
// no_candidates: vector search found nothing close enough (or failed); the rest come from TagVerificationService.
// No reason when the name was already pending review (it isn't checked again).
export type TagToReview = {
  name: TagName;
  reason?: "no_candidates" | "no_match" | "several_matches" | "contradictory" | "llm_failed";
  answers: CandidateAnswer[];
};
// notInUniverse: the verification LLM says it isn't an HP/GOT entity; rejected: a reviewer rejected it before.
export type ResolveTagsResult = { resolved: ResolvedTag[]; toReview: TagToReview[]; notInUniverse: TagName[]; rejected: TagName[] };

// What resolveTags() needs beyond the vocabulary. Without an embedder or verification service,
// names that aren't in the vocabulary or the map go to review.
export type TagResolutionDeps = {
  mappingRepo: TagMappingRepository;
  candidateRepo: TagCandidateRepository;
  vectorSearch: VectorSearchService;
  embedder?: Embedder;
  verification?: TagVerificationService;
};

// How many nearest tags the verification LLM is shown, and the vector score below which a tag
// isn't worth showing (Atlas cosine score, 0..1).
const SHORTLIST_SIZE = numberEnv("TAG_SHORTLIST_SIZE", 5);
const SHORTLIST_MIN_SCORE = numberEnv("TAG_SHORTLIST_MIN_SCORE", 0.85);

const UNIVERSE_NAMES: Record<Universe, string> = { HP: "Harry Potter", GOT: "Game of Thrones" };

// The text embedded for a tag, for vocabulary tags and new names alike: same format on both sides,
// so the vectors are comparable. Changing it means re-embedding the vocabulary.
export function tagEmbeddingText(name: TagName): string {
  return `${name.label} (${name.type}, ${UNIVERSE_NAMES[name.universe]})`;
}

// Resolved tags as a post stores them: ids grouped by type, no duplicates.
export function groupTagIds(resolved: ResolvedTag[]): GroupedTagIds {
  const grouped: GroupedTagIds = { person: [], place: [], artifact: [], event: [] };
  for (const r of resolved) {
    if (!grouped[r.name.type].includes(r.tagId)) grouped[r.name.type].push(r.tagId);
  }
  return grouped;
}

type ResolveContext = { postText: string; postId?: string; requestId?: string };

const nameKey = (n: { type: string; universe: string; label: string }) => `${n.type}|${n.universe}|${tagNameKey(n.label)}`;

export class TagService {
  constructor(
    private readonly tagRepo: TagRepository,
    private readonly resolution?: TagResolutionDeps
  ) {}

  async searchTags(search: string, type?: string, universe?: string): Promise<TagDocument[]> {
    if (!search) {
      return this.tagRepo.findAll(type, universe);
    }
    return this.tagRepo.searchByLabel(search, type, universe);
  }

  async findTagsByIds(ids: string[]): Promise<TagDocument[]> {
    return this.tagRepo.findByIds(ids);
  }

  async upsertTagsAndGetGroupedIds(rawTags: TagInput[]): Promise<GroupedTagIds> {
    const docs = await this.tagRepo.upsertManyAndReturnDocs(rawTags);
    const grouped: GroupedTagIds = { person: [], place: [], artifact: [], event: [] };
    for (const doc of docs) {
      grouped[doc.type].push(String(doc._id));
    }
    return grouped;
  }

  // Maps tag names onto the fixed vocabulary:
  //   1. vocabulary: a tag with this label (case-insensitive)
  //   2. map:        a name seen before ("The Imp" → Tyrion Lannister)
  //      review queue: already pending → stays in review (no new check); rejected by a reviewer → dropped
  //   3. vectors:    embed the name, find the nearest vocabulary tags (same type + universe)
  //   4. LLM:        verification picks exactly one → that tag, saved to the map for next time;
  //                  not an HP/GOT entity → notInUniverse; otherwise → toReview
  async resolveTags(names: TagName[], context: ResolveContext): Promise<ResolveTagsResult> {
    const result = await this.resolve(names, context);
    this.countOutcomes(result);
    return result;
  }

  private async resolve(names: TagName[], context: ResolveContext): Promise<ResolveTagsResult> {
    if (!this.resolution) throw new Error("TagService was created without tag resolution dependencies");
    const { mappingRepo, candidateRepo, verification } = this.resolution;
    const result: ResolveTagsResult = { resolved: [], toReview: [], notInUniverse: [], rejected: [] };

    // The same name twice in one post is one name.
    const left = new Map<string, TagName>();
    for (const n of names) {
      const label = n.label.trim();
      if (label) left.set(nameKey(n), { ...n, label });
    }

    // 1. Vocabulary
    for (const tag of await this.tagRepo.findByLabels([...left.values()])) {
      const name = left.get(nameKey(tag));
      if (!name) continue;
      result.resolved.push({ name, tagId: String(tag._id), tagLabel: tag.label, how: "vocabulary" });
      left.delete(nameKey(tag));
    }

    // 2. Map
    const mappings = await mappingRepo.findByNames([...left.values()]);
    const mappedTags = new Map((await this.tagRepo.findByIds(mappings.map((m) => String(m.tagId)))).map((t) => [String(t._id), t]));
    for (const m of mappings) {
      const key = `${m.type}|${m.universe}|${m.labelKey}`;
      const name = left.get(key);
      const tag = mappedTags.get(String(m.tagId));
      if (!name || !tag) continue; // a mapping to a deleted tag is ignored
      result.resolved.push({ name, tagId: String(tag._id), tagLabel: tag.label, how: "map" });
      left.delete(key);
    }

    // Already in the review queue: no vector search or LLM call again until a reviewer decides.
    for (const c of await candidateRepo.findByNames([...left.values()])) {
      const key = `${c.type}|${c.universe}|${c.labelKey}`;
      const name = left.get(key);
      if (!name) continue;
      if (c.status === "pending") result.toReview.push({ name, answers: [] });
      else if (c.status === "rejected") result.rejected.push(name);
      else continue; // approved/merged: the vocabulary or the map already answered it
      left.delete(key);
    }

    if (!left.size) return result;

    // 3. Nearest vocabulary tags
    const unknown = [...left.values()];
    const nearest = await this.findNearestTags(unknown);
    const toVerify = unknown.map((name, i) => ({ name, candidates: nearest[i] })).filter((it) => it.candidates.length);
    for (const [i, name] of unknown.entries()) {
      if (!nearest[i].length) result.toReview.push({ name, reason: "no_candidates", answers: [] });
    }
    if (!toVerify.length) return result;

    // 4. Verification
    const verifications = verification
      ? await verification.verify(toVerify, context)
      : toVerify.map((it) => ({ decision: "review" as const, reason: "llm_failed" as const, answers: it.candidates }));
    for (const [i, v] of verifications.entries()) {
      const name = toVerify[i].name;
      if (v.decision === "match") {
        result.resolved.push({ name, tagId: v.tagId, tagLabel: v.tagLabel, how: "llm" });
        await mappingRepo.save(name, v.tagId, "llm");
      } else if (v.decision === "not_in_universe") {
        result.notInUniverse.push(name);
      } else {
        result.toReview.push({ name, reason: v.reason, answers: v.answers });
      }
    }
    return result;
  }

  private countOutcomes(result: ResolveTagsResult): void {
    for (const r of result.resolved) tagResolutionsTotal.inc({ outcome: r.how });
    tagResolutionsTotal.inc({ outcome: "review" }, result.toReview.length);
    tagResolutionsTotal.inc({ outcome: "not_in_universe" }, result.notInUniverse.length);
    tagResolutionsTotal.inc({ outcome: "rejected" }, result.rejected.length);
  }

  // Puts names resolveTags() couldn't map into the review queue, linked to the post.
  async queueForReview(items: TagToReview[], post: { postId: string; text: string }): Promise<void> {
    if (!this.resolution) throw new Error("TagService was created without tag resolution dependencies");
    for (const it of items) {
      const isNew = await this.resolution.candidateRepo.enqueue(it.name, it, post);
      if (!isNew) continue;
      tagReviewQueueNewEntriesTotal.inc({ type: it.name.type, universe: it.name.universe, reason: it.reason ?? "unknown" });
      logger.info(
        { task: "tag_review", label: it.name.label, type: it.name.type, universe: it.name.universe, reason: it.reason, postId: post.postId },
        "New name in the tag review queue"
      );
    }
  }

  // Nearest vocabulary tags for each name (same type + universe, closest first). Empty lists when
  // there's no embedder or the search fails, so those names go to review instead of being guessed.
  async findNearestTags(names: TagName[]): Promise<{ tagId: string; label: string; score: number }[][]> {
    const { embedder, vectorSearch } = this.resolution ?? {};
    if (!embedder || !vectorSearch) return names.map(() => []);
    try {
      const vectors = await embedder.embed(names.map(tagEmbeddingText));
      return await Promise.all(
        names.map(async (name, i) => {
          const hits = await vectorSearch.search<{ label: string }>(this.tagRepo.tagModel, {
            index: TAG_VECTOR_INDEX,
            path: "embedding",
            vector: vectors[i],
            filter: { type: name.type, universe: name.universe },
            limit: SHORTLIST_SIZE,
            fields: { label: 1 },
          });
          return hits.filter((h) => h.score >= SHORTLIST_MIN_SCORE).map((h) => ({ tagId: h._id, label: h.label, score: h.score }));
        })
      );
    } catch (err) {
      logger.warn({ message: err instanceof Error ? err.message : String(err) }, "Tag vector search failed; sending names to review");
      return names.map(() => []);
    }
  }
}
