import { Schema, Types } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { TAG_TYPES, UNIVERSES } from "../types/custom-types";

// pending:  waiting for a reviewer
// approved: added to the vocabulary as a new tag (resolvedTagId)
// merged:   mapped to an existing tag (resolvedTagId, plus a tag_mappings entry)
// rejected: not a real tag; dropped whenever the name is seen again
export const TAG_CANDIDATE_STATUSES = ["pending", "approved", "merged", "rejected"] as const;
export type TagCandidateStatus = (typeof TAG_CANDIDATE_STATUSES)[number];

// Why a name is in the review queue, in plain words. Stored next to the code (reasonText) so the
// database explains itself, and shown by npm run review-tags.
export const REVIEW_REASON_TEXT: Record<string, string> = {
  no_candidates: "Nothing in the vocabulary looked similar.",
  no_match: "No existing tag matched it.",
  several_matches: "It looked like more than one tag; please choose.",
  contradictory: "The automatic check couldn't decide.",
  llm_failed: "The automatic check couldn't decide.",
};

// The review queue: names from posts that couldn't be mapped to exactly one vocabulary tag.
const tagCandidateSchema = new Schema(
  {
    type:     { type: String, enum: TAG_TYPES, required: true },
    universe: { type: String, enum: UNIVERSES, required: true },
    labelKey: { type: String, required: true }, // tagNameKey(label), same key as tag_mappings
    label:    { type: String, required: true }, // as first seen
    status:   { type: String, enum: TAG_CANDIDATE_STATUSES, required: true, default: "pending" },
    // Why it needs review (latest): no_candidates | no_match | several_matches | contradictory | llm_failed
    reason:     { type: String },
    reasonText: { type: String }, // REVIEW_REASON_TEXT[reason]
    occurrences: { type: Number, default: 0 },
    // Posts that mentioned it; they get the tag when it's approved or merged.
    postIds:    { type: [Schema.Types.ObjectId], ref: "Post", default: [] },
    sampleText: { type: String }, // the first post that mentioned it, for context while reviewing
    // Nearest vocabulary tags when it was checked, with the LLM's 0/1 for each.
    answers: {
      type: [{ _id: false, tagId: Schema.Types.ObjectId, label: String, score: Number, same: Number }],
      default: [],
    },
    resolvedTagId: { type: Schema.Types.ObjectId, ref: "Tag" },
    lastSeenAt:    { type: Date },
    decidedAt:     { type: Date },
  },
  { collection: "tag_candidates", timestamps: true, versionKey: false }
);

tagCandidateSchema.index({ type: 1, universe: 1, labelKey: 1 }, { unique: true });
tagCandidateSchema.index({ status: 1, occurrences: -1 });
tagCandidateSchema.index({ status: 1, createdAt: 1 }); // oldest pending, for the queue-age metric

export type TagCandidateDocument = InferSchemaType<typeof tagCandidateSchema> & { _id: Types.ObjectId };
export type TagCandidateModelType = Model<TagCandidateDocument>;

export function createTagCandidateModel(conn: DbConnection<Connection>): TagCandidateModelType {
  return (conn.native.models.TagCandidate as TagCandidateModelType) || conn.native.model<TagCandidateDocument>("TagCandidate", tagCandidateSchema);
}
