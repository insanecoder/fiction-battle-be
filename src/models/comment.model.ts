import { Schema, Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const commentSchema = new Schema(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true
    },

    authorId: { type: String, required: true },
    content: { type: String, required: true },

    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    replyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdAt: {
      type: Date,
      required: true,
    },
  },
  { versionKey: false }
);

commentSchema.index({ postId: 1 });
commentSchema.index({ authorId: 1 });


export type CommentDocument = InferSchemaType<typeof commentSchema>;
export type CommentModelType = Model<CommentDocument>;

export function createCommenttModel(connection: DbConnection<Connection>): CommentModelType {
  return connection.native.models.Comment as CommentModelType || connection.native.model<CommentDocument>("Comment", commentSchema);
}