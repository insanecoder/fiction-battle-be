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
import { LLMLogRepository } from "../ai/logging/llm-log.repository";
import { PostTaggingService } from "../ai/post-tagging/post-tagging.service";
import { TagMappingRepository } from "../features/tags/tag-mapping.repository";
import { TagCandidateRepository } from "../features/tags/tag-candidate.repository";
import { createEmbedder } from "../ai/embeddings/embedder";
import { VectorSearchService } from "../ai/vector-search/vector-search.service";
import { TagVerificationService } from "../ai/tag-verification/tag-verification.service";

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
  const llmLogRepo   = new LLMLogRepository(conn);

  // Tag resolution: vocabulary → map → vector search → verification LLM. Without LLM_API_KEY,
  // only the vocabulary and the map are checked; other names are left for review.
  const tagService     = new TagService(tagRepo, {
    mappingRepo:   new TagMappingRepository(conn),
    candidateRepo: new TagCandidateRepository(conn),
    vectorSearch: new VectorSearchService(),
    embedder:     createEmbedder(),
    verification: process.env.LLM_API_KEY ? new TagVerificationService(llmLogRepo) : undefined,
  });
  const postTaggingService = new PostTaggingService(llmLogRepo, postRepo, tagService);
  const postService    = new PostService(postRepo, postLikeRepo, userRepo, tagService, analyticsService, activityRepo, postTaggingService);
  const commentService = new CommentService(commentRepo, postRepo, userRepo, analyticsService, activityRepo);

  const postController    = new PostController(postService);
  const commentController = new CommentController(commentService);
  const tagController     = new TagController(tagService);

  return { postController, commentController, tagController };
}
