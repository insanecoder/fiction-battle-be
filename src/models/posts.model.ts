import { Schema, Types } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { TAGGING_ERROR_CODES, TAGGING_STATUSES, UNIVERSES, type Universe } from "../types/custom-types";


const tagSchema = new Schema(
  {
    person:   { type: [Types.ObjectId], ref: "Tag", default: [] },
    place:    { type: [Types.ObjectId], ref: "Tag", default: [] },
    artifact: { type: [Types.ObjectId], ref: "Tag", default: [] },
    event:    { type: [Types.ObjectId], ref: "Tag", default: [] },
  },
  { _id: false }
);

export const postSchema = new Schema(
  {
    authorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    tags: {
      type: [tagSchema],
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Universes the post is about: one, or both for a crossover post. Empty means untagged — it
    // doesn't count toward either side's analytics and is hidden from everyone but its author.
    // Posts written before this was a list hold a plain string; read it through postUniverses().
    universe: {
      type: [{ type: String, enum: UNIVERSES }],
      default: [],
      index: true,
    },
    createdAt: {
      type: Date,
      required: true,
    },
    // Unset on posts created before tagging status was tracked, or while tagging is disabled.
    tagging: {
      status: { type: String, enum: TAGGING_STATUSES },
      error:  { type: String, enum: TAGGING_ERROR_CODES },
      updatedAt: { type: Date },
    },
  },
  {
    versionKey: false,
  }
);

postSchema.index({ createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ universe: 1, createdAt: -1 });

postSchema.index({ "tags.person": 1 });
postSchema.index({ "tags.place": 1 });
postSchema.index({ "tags.artifact": 1 });
postSchema.index({ "tags.event": 1 });


export type PostDocument = InferSchemaType<typeof postSchema> & { _id: Types.ObjectId };
export type PostModelType = Model<PostDocument>;

// Reads a post's universes whether it's stored as a list or as a legacy single string.
export function postUniverses(post: { universe?: unknown }): Universe[] {
  const value = post.universe;
  if (Array.isArray(value)) return value as Universe[];
  return typeof value === "string" ? [value as Universe] : [];
}

export function createPostModel(connection: DbConnection<Connection>): PostModelType {
  return connection.native.models.Post as PostModelType || connection.native.model<PostDocument>("Post", postSchema);
}