import { PostsRepository } from "./posts.repository";
import { PostLikeRepository } from "./post-like.repository";
import { UserRepository } from "../user/user.repository";
import { TagService } from "../tags/tag.service";
import { CreatePostBody, PostsFilterBody } from "../../validations/posts.schema";
import { AnalyticsService } from "../analytics/analytics.service";
import { ActivityRepository } from "../analytics/activity.repository";

export class PostService {
  constructor(
    private readonly postRepo:        PostsRepository,
    private readonly postLikeRepo:    PostLikeRepository,
    private readonly userRepo:        UserRepository,
    private readonly tagService:      TagService,
    private readonly analyticsService: AnalyticsService,
    private readonly activityRepo:     ActivityRepository,
  ) {}

  async createPost(input: { authorId: string; body: CreatePostBody }) {
    const universe = input.body.universe;

    // Tags belong to a universe (tag.model.ts requires it), so a universe-less
    // post can't carry tags — anything submitted without a universe is dropped.
    const rawTags = universe
      ? (input.body.tags ?? []).map((t) => ({ ...t, universe }))
      : [];
    const groupedIds = rawTags.length
      ? await this.tagService.upsertTagsAndGetGroupedIds(rawTags)
      : { person: [], place: [], artifact: [], event: [] };

    const post = await this.postRepo.create({
      authorId:  input.authorId,
      content:   input.body.content,
      tags:      [groupedIds],
      universe,
      createdAt: new Date(),
    });

    const activityContent = universe
      ? `New post by ${input.authorId} in ${universe}`
      : `New post by ${input.authorId}`;
    await this.activityRepo.create({
      type:     "POST",
      content:  activityContent,
      universe,
      postId:   String(post._id),
    });

    // A universe-less post doesn't count toward either side's analytics
    if (universe) {
      const personLabels = rawTags.filter((t) => t.type === "person").map((t) => t.label);
      await this.analyticsService.recordPostCreated(universe, personLabels);
    }

    return post;
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.postRepo.findById(postId);
    if (!post) throw new Error("Post not found");

    const result = await this.postLikeRepo.toggleLike(postId, userId);
    const universe = post.universe as "HP" | "GOT" | undefined;

    if (universe) {
      await this.analyticsService.recordLikeDelta(universe, result.liked ? 1 : -1);
      if (result.liked) {
        await this.activityRepo.create({
          type:     "LIKE",
          content:  `Post in ${universe} received a new like`,
          universe,
          postId,
        });
      }
    }

    return result;
  }

  async filterPosts(filter: PostsFilterBody, requestingUserId?: string) {
    const posts = await this.postRepo.filterPosts(filter);

    const allTagIds = new Set<string>();
    for (const post of posts) {
      const postTags = post.tags?.[0] as any;
      [...(postTags.person ?? []), ...(postTags.place ?? []), ...(postTags.artifact ?? []), ...(postTags.event ?? [])]
        .forEach((id: any) => allTagIds.add(String(id)));
    }
    const tagDocs = allTagIds.size > 0 ? await this.tagService.findTagsByIds([...allTagIds]) : [];
    const tagMap  = new Map(tagDocs.map((t) => [String(t._id), t]));

    const authorIds = [...new Set(posts.map((p) => p.authorId))];
    const users     = await this.userRepo.findByIds(authorIds);
    const userMap   = new Map(users.map((u) => [String(u._id), u]));

    const postIds      = posts.map((p) => String(p._id));
    const likedPostIds = requestingUserId
      ? await this.postLikeRepo.findLikedPostIds(postIds, requestingUserId)
      : new Set<string>();

    const TAG_TYPES = ["person", "place", "artifact", "event"] as const;

    const enrichedPosts = posts.map((post) => {
      const postTags = post.tags?.[0] as any;
      const resolvedTags: any[] = [];
      for (const tagType of TAG_TYPES) {
        const tagIds = postTags?.[tagType] ?? [];
        resolvedTags.push(...tagIds.map((id: any) => tagMap.get(String(id))));
      }

      const postId = String(post._id);
      return {
        postId,
        authorId:             post.authorId,
        content:              post.content,
        universe:             post.universe,
        likeCount:            post.likeCount,
        commentCount:         post.commentCount,
        isLikedByCurrentUser: likedPostIds.has(postId),
        user:                 userMap.get(post.authorId),
        createDateTime:       new Date(post.createdAt),
        resolvedTags,
      };
    });

    enrichedPosts.sort((a, b) => {
      const aOwn = a.authorId === requestingUserId;
      const bOwn = b.authorId === requestingUserId;
      if (aOwn && !bOwn) return -1;
      if (!aOwn && bOwn) return  1;
      return b.createDateTime.getTime() - a.createDateTime.getTime();
    });

    const { page, pageSize } = filter;
    const start = (page - 1) * pageSize;
    const paged = enrichedPosts.slice(start, start + pageSize);

    return {
      posts: paged,
      pagination: {
        page,
        pageSize,
        totalSize: enrichedPosts.length,
        hasMore: start + pageSize < enrichedPosts.length,
      },
    };
  }
}
