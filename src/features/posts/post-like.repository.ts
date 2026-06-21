import type { Connection } from "mongoose";
import { DbConnection } from "../../db/database-client";
import { createPostLikeModel, PostLikeModelType } from "../../models/post-like.model";
import { createPostModel, PostModelType } from "../../models/posts.model";
import { observeDbOperation } from "../../observability/dbObservability";

export class PostLikeRepository {
  private readonly postLikeModel: PostLikeModelType;
  private readonly postModel: PostModelType;

  constructor(conn: DbConnection<Connection>) {
    this.postLikeModel = createPostLikeModel(conn);
    this.postModel     = createPostModel(conn);
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    return observeDbOperation({ operation: "update", entity: "post_likes" }, async () => {
      const existing = await this.postLikeModel.findOne({ postId, userId });

      if (existing) {
        await this.postLikeModel.deleteOne({ postId, userId });
        const updated = await this.postModel.findByIdAndUpdate(
          postId,
          { $inc: { likeCount: -1 } },
          { new: true, projection: { likeCount: 1 } }
        ).lean();
        return { liked: false, likeCount: updated?.likeCount ?? 0 };
      } else {
        await this.postLikeModel.create({ postId, userId });
        const updated = await this.postModel.findByIdAndUpdate(
          postId,
          { $inc: { likeCount: 1 } },
          { new: true, projection: { likeCount: 1 } }
        ).lean();
        return { liked: true, likeCount: updated?.likeCount ?? 0 };
      }
    });
  }

  async findLikedPostIds(postIds: string[], userId: string): Promise<Set<string>> {
    return observeDbOperation({ operation: "find", entity: "post_likes" }, async () => {
      const docs = await this.postLikeModel
        .find({ postId: { $in: postIds }, userId })
        .select("postId")
        .lean();
      return new Set(docs.map((d) => String(d.postId)));
    });
  }

  // Used only by the seed script to bulk-insert historical likes for seeded posts
  async seedLikes(likes: { postId: string; userId: string }[]): Promise<void> {
    if (!likes.length) return;
    await this.postLikeModel.insertMany(likes, { ordered: false });
  }
}
