import { DatabaseConnPools } from "../types/custom-types";
import { PostsRepository } from "../features/posts/posts.repository";
import { PostLikeRepository } from "../features/posts/post-like.repository";
import { UserRepository } from "../features/user/user.repository";
import { PostService } from "../features/posts/posts.service";
import { PostController } from "../features/posts/posts.controller";
import { CommentRepository } from "../features/comments/comment.repository";
import { CommentService } from "../features/comments/comment.service";
import { CommentController } from "../features/comments/comment.controller";
import { TagRepository } from "../features/tags/tag.repository";
import { TagService } from "../features/tags/tag.service";
import { TagController } from "../features/tags/tag.controller";
import { Connection } from "mongoose";
import { AnalyticsService } from "../features/analytics/analytics.service";
import { ActivityRepository } from "../features/analytics/activity.repository";

export function buildPostModule(
  dbConnPool: DatabaseConnPools<Connection>,
  analyticsService: AnalyticsService,
  activityRepo: ActivityRepository,
) {
  const conn = dbConnPool["primary"];

  const postRepo     = new PostsRepository(conn);
  const postLikeRepo = new PostLikeRepository(conn);
  const userRepo     = new UserRepository(conn);
  const commentRepo  = new CommentRepository(conn);
  const tagRepo      = new TagRepository(conn);

  const tagService     = new TagService(tagRepo);
  const postService    = new PostService(postRepo, postLikeRepo, userRepo, tagService, analyticsService, activityRepo);
  const commentService = new CommentService(commentRepo, postRepo, userRepo, analyticsService, activityRepo);

  const postController    = new PostController(postService);
  const commentController = new CommentController(commentService);
  const tagController     = new TagController(tagService);

  return { postController, commentController, tagController };
}
