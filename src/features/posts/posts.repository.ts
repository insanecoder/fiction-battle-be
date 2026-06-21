// src/features/posts/posts.repository.ts
import type { Connection } from "mongoose";
import { createPostModel, type PostDocument, type PostModelType } from "../../models/posts.model";
import { observeDbOperation } from "../../observability/dbObservability";
import { DbConnection } from "../../db/database-client";
import type { PostsFilterBody } from "../../validations/posts.schema";


type TagGroup = { person: string[]; place: string[]; artifact: string[]; event: string[] };

type CreatePostInput = {
  authorId:      string;
  content:       string;
  tags?:         TagGroup[];
  createdAt?:    Date;
  universe?:     string;
  likeCount?:    number;
  commentCount?: number;
  fixedTime?:    string;
  offsetDays?:   number;
};

export class PostsRepository {
  private readonly postModel: PostModelType;

  constructor(private readonly conn: DbConnection<Connection>) {
    this.postModel = createPostModel(conn);
  }

  async create(input: CreatePostInput): Promise<PostDocument> {
    return observeDbOperation(
      { operation: "create", entity: "posts" },
      async () => {
        const doc = await this.postModel.create({
          authorId:     input.authorId,
          content:      input.content,
          tags:         input.tags,
          createdAt:    input.createdAt,
          universe:     input.universe,
          likeCount:    input.likeCount,
          commentCount: input.commentCount,
          fixedTime:    input.fixedTime,
          offsetDays:   input.offsetDays,
        });
        return doc;
      }
    );
  }

  async filterPosts(filter: PostsFilterBody): Promise<PostDocument[]> {
    return observeDbOperation(
      { operation: "find", entity: "posts" },
      async () => {
        const query: Record<string, unknown> = {};

        if (filter.text) {
          query.content = { $regex: filter.text, $options: "i" };
        }
        if (filter.universe?.length) {
          query.universe = { $in: filter.universe };
        }
        const tagConditions: Record<string, unknown>[] = [];
        if (filter.person?.length)    tagConditions.push({ "tags.person":   { $in: filter.person } });
        if (filter.place?.length)     tagConditions.push({ "tags.place":    { $in: filter.place } });
        if (filter.events?.length)    tagConditions.push({ "tags.event":    { $in: filter.events } });
        if (filter.artifacts?.length) tagConditions.push({ "tags.artifact": { $in: filter.artifacts } });
        if (tagConditions.length > 0) query.$or = tagConditions;
        return this.postModel.find(query).lean();
      }
    );
  }

  async findById(postId: string): Promise<PostDocument | null> {
    return this.postModel.findById(postId).lean();
  }

  async incrementCommentCount(postId: string): Promise<void> {
    await this.postModel.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });
  }

}