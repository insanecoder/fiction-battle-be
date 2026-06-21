import { CommentRepository } from "./comment.repository";
import { PostsRepository } from "../posts/posts.repository";
import { UserRepository } from "../user/user.repository";
import { resolveCreatedAt } from "../posts/posts.service";

export class CommentService {
  constructor(
    private readonly commentRepo: CommentRepository,
    private readonly postRepo:    PostsRepository,
    private readonly userRepo:    UserRepository,
  ) {}

  private async enrichWithUsers(docs: any[]) {
    const resolved = docs.map(c => ({ ...c, createDateTime: resolveCreatedAt(c) }));
    const authorIds = [...new Set(resolved.map(c => c.authorId as string))];
    const users = await this.userRepo.findByIds(authorIds);
    const userMap = new Map(users.map(u => [String(u._id), u]));
    return resolved
      .map(c => ({ ...c, user: userMap.get(c.authorId) }))
      .sort((a, b) => a.createDateTime.getTime() - b.createDateTime.getTime());
  }

  async fetchCommentsByPostId(postId: string) {
    const comments = await this.commentRepo.findByPostId(postId);
    return this.enrichWithUsers(comments);
  }

  async fetchRepliesByCommentId(commentId: string) {
    const replies = await this.commentRepo.findRepliesByCommentId(commentId);
    return this.enrichWithUsers(replies);
  }

  async addComment(input: { postId: string; authorId: string; content: string }) {
    const post = await this.postRepo.findById(input.postId);
    if (!post) throw new Error("Post not found");

    const comment = await this.commentRepo.create({
      postId:   input.postId,
      authorId: input.authorId,
      content:  input.content,
      createdAt: new Date(),
    });

    await this.postRepo.incrementCommentCount(input.postId);
    const [enriched] = await this.enrichWithUsers([comment.toObject()]);
    return enriched;
  }

  async addReply(input: { postId: string; parentCommentId: string; authorId: string; content: string }) {
    const post = await this.postRepo.findById(input.postId);
    if (!post) throw new Error("Post not found");

    const parent = await this.commentRepo.findById(input.parentCommentId);
    if (!parent) throw new Error("Comment not found");
    if (String(parent.postId) !== input.postId) throw new Error("Comment does not belong to this post");

    const reply = await this.commentRepo.create({
      postId:          input.postId,
      authorId:        input.authorId,
      content:         input.content,
      parentCommentId: input.parentCommentId,
      createdAt:       new Date(),
    });

    await this.commentRepo.incrementReplyCount(input.parentCommentId);
    const [enriched] = await this.enrichWithUsers([reply.toObject()]);
    return enriched;
  }
}
