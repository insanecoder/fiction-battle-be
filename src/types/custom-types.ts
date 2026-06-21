import { DbConnection } from "../db/database-client";
import { PostController } from "../features/posts/posts.controller";
import { UserController } from "../features/user/user.controller";
import { CommentController } from "../features/comments/comment.controller";
import { TagController } from "../features/tags/tag.controller";

export type DatabaseConnPools<T> = {
  "primary" : DbConnection<T>;
}

export type PostModule = {
  "postController":    PostController;
  "commentController": CommentController;
  "tagController":     TagController;
}
export type UserModule = {
  "userController" : UserController
}

export type AppDependencies = {
  "post" : PostModule,
  "user" : UserModule
}

export const TAG_TYPES = [
  "PERSON",
  "PLACE",
  "EVENTS",
  "ARTIFACTS",
] as const;

export type TagType = typeof TAG_TYPES[number];

export type Universe = "GOT" | "HP";

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