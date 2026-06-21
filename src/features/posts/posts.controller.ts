import type { Request, Response, NextFunction } from "express";
import { PostService } from "./posts.service";
import type { CreatePostBody, PostsFilterBody } from "../../validations/posts.schema";

export class PostController {
  constructor(
    private readonly postService: PostService,
  ) {}

  createPost = async (req: Request, res: Response, next: NextFunction) => {
    const body = req.body as CreatePostBody;
    if(!req?.authUser?.userId) {
        throw new Error("User must be logged in to create a post")
    }
    const post = await this.postService.createPost({
        authorId : req?.authUser?.userId,
        body,
    });

    return res.status(201).json({
    data: post,
    requestId: req.requestId,
    });
  };

  fetchPosts = async (req: Request, res: Response, next: NextFunction) => {
    const filter = req.body as PostsFilterBody;
    const result = await this.postService.filterPosts(filter, req.authUser?.userId);

    return res.status(200).json({
      data: result,
      requestId: req.requestId,
    });
  };

  toggleLike = async (req: Request, res: Response, next: NextFunction) => {
    const postId = req.params["postId"] as string;
    const userId = req.authUser!.userId;
    const result = await this.postService.toggleLike(postId, userId);
    return res.status(200).json({ data: result, requestId: req.requestId });
  };

}