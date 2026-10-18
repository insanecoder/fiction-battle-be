// src/features/posts/posts.repository.ts
import type { Connection } from "mongoose";
import { createPostModel, type PostDocument, type PostModelType } from "../../models/posts.model";
import { observeDbOperation } from "../../observability/dbObservability";
import { DbConnection } from "../../db/database-client";
import type { PostsFilterBody } from "../../validations/posts.schema";
import { TAG_TYPES, UNIVERSES, type TaggingErrorCode, type TaggingStatus, type Universe } from "../../types/custom-types";


type TagGroup = { person: string[]; place: string[]; artifact: string[]; event: string[] };

// A post is "tagged" (visible to everyone) once it has a universe or at least one tag.
// $in matches both the universe list and legacy single-string values.
const TAGGED_CONDITIONS: Record<string, unknown>[] = [
  { universe: { $in: UNIVERSES } },
  ...TAG_TYPES.map((type) => ({ [`tags.${type}.0`]: { $exists: true } })),
];

type CreatePostInput = {
  authorId:      string;
  content:       string;
  tags?:         TagGroup[];
  createdAt:     Date;
  universe?:     Universe[];
  likeCount?:    number;
  commentCount?: number;
  tagging?:      { status: TaggingStatus };
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
          tagging:      input.tagging && { ...input.tagging, updatedAt: input.createdAt },
        });
        return doc;
      }
    );
  }

  // Logged out: only tagged posts. Logged in: tagged posts plus the viewer's own untagged ones,
  // so authors can see why their post isn't showing up for others.
  async filterPosts(filter: PostsFilterBody, viewerId?: string): Promise<PostDocument[]> {
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
        const and: Record<string, unknown>[] = [
          { $or: viewerId ? [...TAGGED_CONDITIONS, { authorId: viewerId }] : TAGGED_CONDITIONS },
        ];
        if (tagConditions.length > 0) and.push({ $or: tagConditions });
        query.$and = and;
        return this.postModel.find(query).lean();
      }
    );
  }

  async findById(postId: string): Promise<PostDocument | null> {
    return this.postModel.findById(postId).lean();
  }

  async findAll(): Promise<PostDocument[]> {
    return observeDbOperation(
      { operation: "find", entity: "posts_all" },
      () => this.postModel.find({}).lean()
    );
  }

  async incrementCommentCount(postId: string): Promise<void> {
    await this.postModel.findByIdAndUpdate(postId, { $inc: { commentCount: 1 } });
  }

  // Adds LLM-generated tag ids next to any the author chose ($addToSet: no duplicates, nothing removed).
  async addAutoTags(postId: string, tagIds: TagGroup): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "posts_auto_tags" }, async () => {
      const addToSet: Record<string, { $each: string[] }> = {};
      for (const type of TAG_TYPES) {
        if (tagIds[type].length) addToSet[`tags.0.${type}`] = { $each: tagIds[type] };
      }
      if (Object.keys(addToSet).length) {
        await this.postModel.updateOne({ _id: postId }, { $addToSet: addToSet });
      }
    });
  }

  // Adds universes next to any the author chose ($addToSet: no duplicates, nothing removed), so an
  // HP post the tagger also finds GOT in becomes a crossover. Expects migrated (list) posts.
  async addUniverses(postId: string, universes: Universe[]): Promise<void> {
    if (!universes.length) return;
    await observeDbOperation({ operation: "update", entity: "posts_auto_universe" }, async () => {
      await this.postModel.updateOne({ _id: postId }, { $addToSet: { universe: { $each: universes } } });
    });
  }

  async markTaggingFailed(postId: string, error: TaggingErrorCode): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "posts_tagging_status" }, async () => {
      await this.postModel.updateOne(
        { _id: postId },
        { $set: { tagging: { status: "failed", error, updatedAt: new Date() } } }
      );
    });
  }

  // Marks tagging done if the post ended up tagged; otherwise it's a failure with fallbackError.
  async markTaggingFinished(postId: string, fallbackError: TaggingErrorCode): Promise<TaggingStatus> {
    return observeDbOperation({ operation: "update", entity: "posts_tagging_status" }, async () => {
      const res = await this.postModel.updateOne(
        { _id: postId, $or: TAGGED_CONDITIONS },
        { $set: { tagging: { status: "done", updatedAt: new Date() } } }
      );
      if (res.matchedCount) return "done";
      await this.postModel.updateOne(
        { _id: postId },
        { $set: { tagging: { status: "failed", error: fallbackError, updatedAt: new Date() } } }
      );
      return "failed";
    });
  }

}