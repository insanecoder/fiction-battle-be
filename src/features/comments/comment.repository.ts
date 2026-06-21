import { Types, Connection } from "mongoose";
import { CommentModelType, createCommenttModel } from "../../models/comment.model";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";

type CreateCommentInput = {
  postId:           string;
  authorId:         string;
  content:          string;
  parentCommentId?: string | null;
  likeCount?:       number;
  replyCount?:      number;
  fixedTime?:       string;
  offsetDays?:      number;
  createdAt?:       Date;
};

export class CommentRepository {
  private readonly commentModel: CommentModelType;

  constructor(conn: DbConnection<Connection>) {
    this.commentModel = createCommenttModel(conn);
  }

  async create(input: CreateCommentInput) {
    return observeDbOperation({ operation: "create", entity: "comments" }, () =>
      this.commentModel.create({
        postId:          new Types.ObjectId(input.postId),
        authorId:        input.authorId,
        content:         input.content,
        parentCommentId: input.parentCommentId ? new Types.ObjectId(input.parentCommentId) : null,
        likeCount:  input.likeCount  ?? 0,
        replyCount: input.replyCount ?? 0,
        fixedTime:  input.fixedTime  ?? null,
        offsetDays: input.offsetDays ?? null,
        createdAt:  input.createdAt  ?? null,
      })
    );
  }

  async findById(commentId: string) {
    return this.commentModel.findById(commentId).lean();
  }

  async findByPostId(postId: string) {
    return observeDbOperation({ operation: "find", entity: "comments" }, () =>
      this.commentModel
        .find({ postId: new Types.ObjectId(postId), parentCommentId: null })
        .lean()
    );
  }

  async findRepliesByCommentId(parentCommentId: string) {
    return observeDbOperation({ operation: "find", entity: "comments" }, () =>
      this.commentModel
        .find({ parentCommentId: new Types.ObjectId(parentCommentId) })
        .lean()
    );
  }

  async incrementReplyCount(commentId: string) {
    return this.commentModel.findByIdAndUpdate(commentId, { $inc: { replyCount: 1 } });
  }
}
