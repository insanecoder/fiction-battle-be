import type { Request, Response, NextFunction } from "express";
import { CommentService } from "./comment.service";
import type { AddCommentBody, AddReplyBody } from "../../validations/comment.schema";

export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  fetchCommentsByPostId = async (req: Request, res: Response, next: NextFunction) => {
    const { postId } = req.params;
    const comments = await this.commentService.fetchCommentsByPostId(postId);
    return res.status(200).json({ data: comments, requestId: req.requestId });
  };

  fetchRepliesByCommentId = async (req: Request, res: Response, next: NextFunction) => {
    const { commentId } = req.params;
    const replies = await this.commentService.fetchRepliesByCommentId(commentId);
    return res.status(200).json({ data: replies, requestId: req.requestId });
  };

  addComment = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser?.userId) throw new Error("Auth required");
    const { postId } = req.params;
    const { content } = req.body as AddCommentBody;
    const comment = await this.commentService.addComment({
      postId,
      authorId: req.authUser.userId,
      content,
    });
    return res.status(201).json({ data: comment, requestId: req.requestId });
  };

  addReply = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser?.userId) throw new Error("Auth required");
    const { postId, commentId } = req.params;
    const { content } = req.body as AddReplyBody;
    const reply = await this.commentService.addReply({
      postId,
      parentCommentId: commentId,
      authorId:        req.authUser.userId,
      content,
    });
    return res.status(201).json({ data: reply, requestId: req.requestId });
  };
}
