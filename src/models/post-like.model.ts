import { Schema, Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const postLikeSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true },
    userId: { type: String, required: true },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } }
);

postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export type PostLikeDocument = InferSchemaType<typeof postLikeSchema> & { _id: Schema.Types.ObjectId };
export type PostLikeModelType = Model<PostLikeDocument>;

export function createPostLikeModel(connection: DbConnection<Connection>): PostLikeModelType {
  return (connection.native.models.PostLike as PostLikeModelType) ||
    connection.native.model<PostLikeDocument>("PostLike", postLikeSchema);
}
