import type { DbConnection } from "../db/database-client";
import type { PostController } from "../features/posts/posts.controller";
import type { UserController } from "../features/user/user.controller";
import type { CommentController } from "../features/comments/comment.controller";
import type { TagController } from "../features/tags/tag.controller";
import type { AnalyticsController } from "../features/analytics/analytics.controller";

export type DatabaseConnPools<T> = {
  "primary" : DbConnection<T>;
  "analytics" : DbConnection<T>;
}

export type PostModule = {
  "postController":    PostController;
  "commentController": CommentController;
  "tagController":     TagController;
}
export type UserModule = {
  "userController" : UserController
}

export type AnalyticsModule = {
  "analyticsController": AnalyticsController
}

export type AppDependencies = {
  "post" : PostModule,
  "user" : UserModule,
  "analytics" : AnalyticsModule
}

// Single source of truth for universes and tag types. Models, validation and the LLM tagging
// schema derive from these, so adding a universe or tag type starts here.
export const UNIVERSES = ["HP", "GOT"] as const;
export type Universe = (typeof UNIVERSES)[number];

export const TAG_TYPES = ["person", "place", "artifact", "event"] as const;
export type TagType = (typeof TAG_TYPES)[number];

export type TAG_OBJ = {
  "type" : TagType,
  "value" : string
}

export type PostsFilter = {
  "text" : string,
  "universe" : Universe[],
  "person": string[],
  "place" : string[],
  "events" : string[],
  "artifacts":string[]
}
// Background LLM tagging state stored on a post. A post nobody tagged with a universe (and that has
// no tags) is hidden from everyone but its author, who sees the error code's message instead.
export const TAGGING_STATUSES = ["pending", "done", "failed"] as const;
export type TaggingStatus = (typeof TAGGING_STATUSES)[number];

export const TAGGING_ERROR_CODES = ["TAGGING_FAILED", "CONTENT_BLOCKED", "LOW_CONFIDENCE", "NO_UNIVERSE"] as const;
export type TaggingErrorCode = (typeof TAGGING_ERROR_CODES)[number];
