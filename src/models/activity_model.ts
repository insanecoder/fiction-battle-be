import { Schema } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const ACTIVITY_TYPES = ["POST", "COMMENT", "LIKE", "TAG"] as const;
const UNIVERSES = ["HP", "GOT"] as const;

export const activitySchema = new Schema(
  {
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
      index: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    universe: {
      type: String,
      enum: UNIVERSES,
      required: false,
      index: true,
    },

    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// 🔥 Important indexes for feed performance
activitySchema.index({ createdAt: -1 }); // latest feed
activitySchema.index({ type: 1, createdAt: -1 });
activitySchema.index({ universe: 1, createdAt: -1 });

export type ActivityDocument = InferSchemaType<typeof activitySchema>;
export type ActivityModelType = Model<ActivityDocument>;

export function createActivityModel(
  connection: DbConnection<Connection>
): ActivityModelType {
  return (
    (connection.native.models.Activity as ActivityModelType) ||
    connection.native.model<ActivityDocument>("Activity", activitySchema)
  );
}