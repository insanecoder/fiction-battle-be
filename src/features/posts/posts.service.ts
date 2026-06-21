import { PostsRepository } from "./posts.repository";
import { PostLikeRepository } from "./post-like.repository";
import { UserRepository } from "../user/user.repository";
import { TagService } from "../tags/tag.service";
import { CreatePostBody, PostsFilterBody } from "../../validations/posts.schema";
import { PostDocument } from "../../models/posts.model";

export function resolveCreatedAt(
  doc: Pick<PostDocument, "offsetDays" | "fixedTime" | "createdAt">
): Date {
  if (doc.offsetDays != null && doc.fixedTime) {
    const [h, m] = doc.fixedTime.split(":").map(Number);
    const d = new Date();
    d.setDate(d.getDate() - doc.offsetDays);
    d.setHours(h, m, 0, 0);
    return d;
  }
  return doc.createdAt ? new Date(doc.createdAt as unknown as string) : new Date();
}

export class PostService {
  constructor(
    private readonly postRepo:     PostsRepository,
    private readonly postLikeRepo: PostLikeRepository,
    private readonly userRepo:     UserRepository,
    private readonly tagService:   TagService,
  ) {}

  async createPost(input: { authorId: string; body: CreatePostBody }) {
    const rawTags = (input.body.tags ?? []).map((t) => ({ ...t, universe: input.body.universe }));
    const groupedIds = rawTags.length
      ? await this.tagService.upsertTagsAndGetGroupedIds(rawTags)
      : { person: [], place: [], artifact: [], event: [] };

    return this.postRepo.create({
      authorId:  input.authorId,
      content:   input.body.content,
      tags:      [groupedIds],
      universe:  input.body.universe,
      createdAt: new Date(),
    });
  }

  async toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    return this.postLikeRepo.toggleLike(postId, userId);
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
        createDateTime:       resolveCreatedAt(post),
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
