import { Schema, Types } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";


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
    universe: {
      type: String,
      enum: ["HP", "GOT"],
      required: true,
      index: true,
    },
    // Seeded posts only — compute display date dynamically via resolveCreatedAt()
    fixedTime: {
      type: String,
      default: null,
    },
    offsetDays: {
      type: Number,
      default: null,
      min: 0,
    },
    // Real user posts only
    createdAt: {
      type: Date,
      default: null,
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

export function createPostModel(connection: DbConnection<Connection>): PostModelType {
  return connection.native.models.Post as PostModelType || connection.native.model<PostDocument>("Post", postSchema);
}