import type { Connection } from "mongoose";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";
import { createTagCandidateModel, REVIEW_REASON_TEXT, TagCandidateDocument, TagCandidateModelType, TagCandidateStatus } from "../../models/tag-candidate.model";
import { tagNameKey } from "../../models/tag-mapping.model";
import type { TagType, Universe } from "../../types/custom-types";

type TagName = { type: TagType; label: string; universe: Universe };
type CandidateAnswer = { tagId: string; label: string; score: number; same?: 0 | 1 };

const SAMPLE_CHARS = 300;

export class TagCandidateRepository {
  private readonly model: TagCandidateModelType;

  constructor(conn: DbConnection<Connection>) {
    this.model = createTagCandidateModel(conn);
  }

  async findByNames(names: TagName[]): Promise<TagCandidateDocument[]> {
    if (!names.length) return [];
    return observeDbOperation({ operation: "find", entity: "tag_candidates" }, () =>
      this.model.find({ $or: names.map((n) => ({ type: n.type, universe: n.universe, labelKey: tagNameKey(n.label) })) }).lean()
    );
  }

  // Adds the post to the name's review entry, creating it as pending if it's new. A decided entry
  // keeps its status. Answers are only replaced when new ones are given (a pending name isn't re-checked).
  // Returns true when this created a new entry.
  async enqueue(
    name: TagName,
    review: { reason?: string; answers: CandidateAnswer[] },
    post: { postId: string; text: string }
  ): Promise<boolean> {
    const set: Record<string, unknown> = { lastSeenAt: new Date() };
    if (review.reason) Object.assign(set, { reason: review.reason, reasonText: REVIEW_REASON_TEXT[review.reason] ?? review.reason });
    if (review.answers.length) set.answers = review.answers;

    const res = await observeDbOperation({ operation: "update", entity: "tag_candidates" }, () =>
      this.model.updateOne(
        { type: name.type, universe: name.universe, labelKey: tagNameKey(name.label) },
        {
          $inc: { occurrences: 1 },
          $set: set,
          $addToSet: { postIds: post.postId },
          $setOnInsert: { label: name.label.trim(), status: "pending", sampleText: post.text.slice(0, SAMPLE_CHARS) },
        },
        { upsert: true }
      )
    );
    return res.upsertedCount === 1;
  }

  async countPending(): Promise<number> {
    return this.model.countDocuments({ status: "pending" });
  }

  // Seconds the oldest pending entry has been waiting; 0 when nothing is pending.
  async oldestPendingAgeSeconds(): Promise<number> {
    const oldest = await this.model.findOne({ status: "pending" }, { createdAt: 1 }).sort({ createdAt: 1 }).lean();
    return oldest?.createdAt ? Math.round((Date.now() - new Date(oldest.createdAt).getTime()) / 1000) : 0;
  }

  // Waiting for a reviewer, most mentioned first.
  async listPending(): Promise<TagCandidateDocument[]> {
    return this.model.find({ status: "pending" }).sort({ occurrences: -1, createdAt: 1 }).lean();
  }

  async decide(id: string, status: Exclude<TagCandidateStatus, "pending">, resolvedTagId?: string): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "tag_candidates" }, () =>
      this.model.updateOne({ _id: id }, { $set: { status, resolvedTagId, decidedAt: new Date() } })
    );
  }
}
