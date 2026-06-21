import { Router, RequestHandler } from "express";
import { validate } from "../lib/http/validate";
import { createPostSchema, postsFilterSchema } from "../validations/posts.schema";
import { addCommentSchema, addReplySchema } from "../validations/comment.schema";
import { PostModule } from "../types/custom-types";
import { TagController } from "../features/tags/tag.controller";

export function postsRouter(postModule: PostModule, auth: RequestHandler, optionalAuth: RequestHandler, tagController: TagController): Router {
  const router = Router();
  const post    = postModule["postController"];
  const comment = postModule["commentController"];

  // Posts
  router.post("/create-post",  auth, validate(createPostSchema,  "body"), post.createPost);
  router.post("/fetch-posts", optionalAuth, validate(postsFilterSchema, "body"), post.fetchPosts);

  // Tags
  router.get("/tags",        tagController.searchTags);
  router.get("/tags/search", tagController.searchTags);

  // Like / unlike a post (toggle)
  router.post("/:postId/like", auth, post.toggleLike);

  // Comments on a post
  router.get( "/:postId/comments", comment.fetchCommentsByPostId);
  router.post("/:postId/comments", auth, validate(addCommentSchema, "body"), comment.addComment);

  // Replies on a comment
  router.get( "/:postId/comments/:commentId/replies", comment.fetchRepliesByCommentId);
  router.post("/:postId/comments/:commentId/replies", auth, validate(addReplySchema, "body"), comment.addReply);

  return router;
}
