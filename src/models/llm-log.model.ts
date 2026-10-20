import { Schema, Types } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

export const LLM_LOG_STATUSES = ["pending", "success", "blocked", "error"] as const;
export type LLMLogStatus = (typeof LLM_LOG_STATUSES)[number];

// One document per LLM call. Written as "pending" before the call, then updated with the
// outcome, so a call that never finishes (crash, deploy, hang) is still visible.
export const llmLogSchema = new Schema(
  {
    task: { type: String, required: true, index: true }, // e.g. "post_tagging"
    status: { type: String, enum: LLM_LOG_STATUSES, required: true, default: "pending" },

    // What the call was about
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: false, index: true },
    requestId: { type: String, required: false }, // HTTP request that triggered it, for tracing
    input: {
      text: { type: String, required: true },
      chars: { type: Number, required: true },
    },

    // How it was called
    prompt: {
      version: { type: String },
      hash: { type: String },
    },
    schemaHash: { type: String, required: true },
    model: {
      provider: { type: String, required: true },
      name: { type: String, required: true },
      servedBy: { type: String }, // exact model version that answered, filled in after the call
    },
    params: {
      thinkingLevel: { type: String },
      seed: { type: Number },
      maxOutputTokens: { type: Number },
      timeoutMs: { type: Number },
    },

    // What came back (filled in after the call)
    output: { type: Schema.Types.Mixed },
    usage: {
      inputTokens: { type: Number },
      outputTokens: { type: Number },
      cacheReadTokens: { type: Number },
    },
    latencyMs: { type: Number },
    slow: { type: Boolean },
    error: {
      kind: { type: String },
      message: { type: String },
    },

    // What we did with it
    applied: {
      tagCount: { type: Number },
      universe: { type: [String], default: undefined },
      skippedReason: { type: String }, // e.g. low confidence
      mapped: { type: [{ _id: false, label: String, tag: String, how: String }], default: undefined },
      review: { type: [{ _id: false, label: String, reason: String }], default: undefined },
      notInUniverse: { type: [String], default: undefined },
      rejected: { type: [String], default: undefined }, // rejected by a reviewer earlier
    },

    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  { collection: "llm_logging", timestamps: true, versionKey: false }
);

llmLogSchema.index({ task: 1, createdAt: -1 });
llmLogSchema.index({ status: 1, createdAt: -1 });

export type LLMLogDocument = InferSchemaType<typeof llmLogSchema> & { _id: Types.ObjectId };
export type LLMLogModelType = Model<LLMLogDocument>;

export function createLLMLogModel(connection: DbConnection<Connection>): LLMLogModelType {
  return (connection.native.models.LLMLog as LLMLogModelType) || connection.native.model<LLMLogDocument>("LLMLog", llmLogSchema);
}
