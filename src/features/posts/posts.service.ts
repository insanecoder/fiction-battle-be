import { PostsRepository } from "./posts.repository";
import { PostLikeRepository } from "./post-like.repository";
import { UserRepository } from "../user/user.repository";
import { TagService } from "../tags/tag.service";
import { CreatePostBody, PostsFilterBody } from "../../validations/posts.schema";
import { AnalyticsService } from "../analytics/analytics.service";
import { ActivityRepository } from "../analytics/activity.repository";
import { PostTaggingService } from "../../ai/post-tagging/post-tagging.service";
import { TAG_TYPES, type TaggingErrorCode } from "../../types/custom-types";
import { postUniverses, type PostDocument } from "../../models/posts.model";

type PostTaggingError = { code: TaggingErrorCode | "TAGGING_PENDING"; message: string };

const TAGGING_ERROR_MESSAGES: Record<PostTaggingError["code"], string> = {
  TAGGING_PENDING: "We're still tagging this post. It will be visible to others once a universe is attached.",
  TAGGING_FAILED:  "Automatic tagging failed, so no universe is attached and only you can see this post.",
  CONTENT_BLOCKED: "This post couldn't be tagged because of its content, so only you can see it.",
  LOW_CONFIDENCE:  "We couldn't tell which universe this post belongs to, so only you can see it.",
  NO_UNIVERSE:     "No universe is attached to this post, so only you can see it.",
};

// Tagging normally finishes in seconds; a "pending" older than this was lost (e.g. a server restart).
const STALE_PENDING_MS = 10 * 60 * 1000;

function isTagged(post: PostDocument): boolean {
  if (postUniverses(post).length) return true;
  const postTags = post.tags?.[0] as any;
  return TAG_TYPES.some((type) => (postTags?.[type]?.length ?? 0) > 0);
}

// Why an untagged post is hidden from everyone but its author; null once it's tagged.
function taggingErrorFor(post: PostDocument): PostTaggingError | null {
  if (isTagged(post)) return null;
  const tagging = post.tagging;
  let code: PostTaggingError["code"] = (tagging?.error as TaggingErrorCode | undefined) ?? "NO_UNIVERSE";
  if (tagging?.status === "pending") {
    const age = Date.now() - new Date(tagging.updatedAt ?? 0).getTime();
    code = age < STALE_PENDING_MS ? "TAGGING_PENDING" : "TAGGING_FAILED";
  }
  return { code, message: TAGGING_ERROR_MESSAGES[code] };
}

export class PostService {
  constructor(
    private readonly postRepo:        PostsRepository,
    private readonly postLikeRepo:    PostLikeRepository,
    private readonly userRepo:        UserRepository,
    private readonly tagService:      TagService,
    private readonly analyticsService: AnalyticsService,
    private readonly activityRepo:     ActivityRepository,
    private readonly postTaggingService?: PostTaggingService,
  ) {}

  async createPost(input: { authorId: string; body: CreatePostBody; requestId?: string }) {
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
      universe:  universe ? [universe] : [],
      createdAt: new Date(),
      tagging:   this.postTaggingService?.enabled ? { status: "pending" } : undefined,
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

    // LLM tagging runs after the response is sent; tags appear on the post when it finishes.
    this.postTaggingService?.tagInBackground({
      postId:    String(post._id),
      content:   post.content,
      requestId: input.requestId,
    });

    return post;
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    const post = await this.postRepo.findById(postId);
    if (!post) throw new Error("Post not found");

    const result = await this.postLikeRepo.toggleLike(postId, userId);
    const universes = postUniverses(post);

    // A crossover post's like counts toward both sides; the activity entry is written once.
    for (const universe of universes) {
      await this.analyticsService.recordLikeDelta(universe, result.liked ? 1 : -1);
    }
    if (universes.length && result.liked) {
      await this.activityRepo.create({
        type:     "LIKE",
        content:  `Post in ${universes.join(" & ")} received a new like`,
        universe: universes.length === 1 ? universes[0] : undefined,
        postId,
      });
    }

    return result;
  }

  async filterPosts(filter: PostsFilterBody, requestingUserId?: string) {
    const posts = await this.postRepo.filterPosts(filter, requestingUserId);

    const allTagIds = new Set<string>();
    for (const post of posts) {
      const postTags = post.tags?.[0] as any;
      [...(postTags?.person ?? []), ...(postTags?.place ?? []), ...(postTags?.artifact ?? []), ...(postTags?.event ?? [])]
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

    const enrichedPosts = posts.map((post) => {
      const postTags = post.tags?.[0] as any;
      const resolvedTags: any[] = [];
      for (const tagType of TAG_TYPES) {
        const tagIds = postTags?.[tagType] ?? [];
        resolvedTags.push(...tagIds.map((id: any) => tagMap.get(String(id))));
      }

      const postId = String(post._id);
      const isOwn  = post.authorId === requestingUserId;
      return {
        postId,
        authorId:             post.authorId,
        content:              post.content,
        universe:             postUniverses(post),
        likeCount:            post.likeCount,
        commentCount:         post.commentCount,
        isLikedByCurrentUser: likedPostIds.has(postId),
        user:                 userMap.get(post.authorId),
        createDateTime:       new Date(post.createdAt),
        resolvedTags,
        // Only the author ever receives an untagged post, so only they see why it's hidden.
        taggingError:         isOwn ? taggingErrorFor(post) : null,
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
