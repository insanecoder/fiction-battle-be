import path from "path";
import fs from "fs/promises";
import { MongooseAdapter } from "./db/mongo-client";
import { createUserModel, UserModelType } from "./models/user.model";
import { createCommenttModel } from "./models/comment.model";
import { PostsRepository } from "./features/posts/posts.repository";
import { PostLikeRepository } from "./features/posts/post-like.repository";
import { TagRepository } from "./features/tags/tag.repository";
import { TagService } from "./features/tags/tag.service";
import { AnalyticsRepository } from "./features/analytics/analytics.repository";
import { ActivityRepository } from "./features/analytics/activity.repository";
import { AnalyticsService } from "./features/analytics/analytics.service";

const userCache = new Map<string, string>(); // email -> _id

// data-seed.json expresses dates as offsetDays (days before this seed run) + fixedTime
// ("HH:mm") for readable, spread-out fixtures. Resolved to an absolute Date once here,
// at seed time, and stored directly as createdAt — posts/comments no longer carry the
// offset fields, so this resolution only happens during seeding, never at read time.
function resolveSeedDate(offsetDays: number, fixedTime: string): Date {
  const [h, m] = fixedTime.split(":").map(Number);
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(h, m, 0, 0);
  return d;
}

async function main() {
  const mObj = new MongooseAdapter();
  const dbConn = await mObj.connect("primary");
  const analyticsDbConn = await mObj.connect("analytics");

  const filePath = path.join("src", "data-seed.json");
  const data = JSON.parse(await fs.readFile(filePath, "utf-8"));

  const userModel    = createUserModel(dbConn);
  const commentModel = createCommenttModel(dbConn);

  const postRepo     = new PostsRepository(dbConn);
  const postLikeRepo = new PostLikeRepository(dbConn);
  const tagRepo      = new TagRepository(dbConn);
  const tagService   = new TagService(tagRepo);

  const activityRepo   = new ActivityRepository(analyticsDbConn);
  const analyticsRepo  = new AnalyticsRepository(analyticsDbConn);
  const analyticsService = new AnalyticsService(analyticsRepo, activityRepo);

  // Seeded post/comment dates are relative (offsetDays) to whenever this script runs,
  // so every run wipes and rebuilds seed content from scratch — otherwise reseeding
  // would double up posts and the analytics counters would drift from actual counts.
  // Users are kept (real accounts may already have likes/comments on seed posts).
  console.log("🧹 Clearing previous seed data...");
  await dbConn.native.collection("posts").deleteMany({});
  await dbConn.native.collection("comments").deleteMany({});
  await dbConn.native.collection("tags").deleteMany({});
  await dbConn.native.collection("postlikes").deleteMany({});
  await analyticsDbConn.native.collection("universestats").deleteMany({});
  await analyticsDbConn.native.collection("characterstats").deleteMany({});
  await analyticsDbConn.native.collection("dailystats").deleteMany({});
  await analyticsDbConn.native.collection("activities").deleteMany({});

  // Seed top-level users first and collect their IDs for distributing likes
  const allUserIds: string[] = [];
  for (const user of data.users) {
    const userId = await upsertUser(userModel, user);
    allUserIds.push(userId);
  }

  for (const post of data.posts) {
    const authorId = await upsertUser(userModel, post.user);

    const rawTags = (post.tags ?? []).filter(
      (t: any) => ["person", "place", "artifact", "event"].includes(t.type)
    ).map((t: any) => ({ type: t.type, label: t.label, universe: post.universe as "HP" | "GOT" }));

    const groupedIds = rawTags.length
      ? await tagService.upsertTagsAndGetGroupedIds(rawTags)
      : { person: [], place: [], artifact: [], event: [] };

    const postUniverse = post.universe as "HP" | "GOT";
    const postCreatedAt = resolveSeedDate(post.offsetDays, post.fixedTime);

    const createdPost = await postRepo.create({
      authorId,
      content:      post.post,
      tags:         [groupedIds],
      universe:     postUniverse,
      likeCount:    post.likeCount,
      commentCount: post.commentCount,
      createdAt:    postCreatedAt,
    });

    console.log(`📝 Created post #${post.id}`);

    const personLabels = rawTags.filter((t: any) => t.type === "person").map((t: any) => t.label);

    await analyticsService.recordPostCreated(postUniverse, personLabels, postCreatedAt);
    await analyticsService.recordBulkTotals(postUniverse, post.likeCount ?? 0, post.commentCount ?? 0);
    await activityRepo.create({
      type:      "POST",
      content:   `New post by ${post.user.name} in ${postUniverse}`,
      universe:  postUniverse,
      postId:    String(createdPost._id),
      createdAt: postCreatedAt,
    });

    // Distribute likes across seeded users (up to available users, capped at seeded likeCount)
    const likeCount = post.likeCount ?? 0;
    const likesToSeed = allUserIds.slice(0, likeCount);
    if (likesToSeed.length > 0) {
      await postLikeRepo.seedLikes(
        likesToSeed.map((userId) => ({ postId: String(createdPost._id), userId }))
      );
      await activityRepo.create({
        type:      "LIKE",
        content:   `Post by ${post.user.name} in ${postUniverse} received ${likeCount} new likes`,
        universe:  postUniverse,
        postId:    String(createdPost._id),
        createdAt: postCreatedAt,
      });
    }

    if (!post.comments?.length) continue;

    for (const comment of post.comments) {
      const commentAuthorId = await upsertUser(userModel, comment.user);

      if (comment.offsetDays > post.offsetDays) {
        throw new Error(`Post #${post.id}: comment offsetDays(${comment.offsetDays}) > post offsetDays(${post.offsetDays}) — comment is older than post`);
      }
      if (comment.offsetDays === post.offsetDays && comment.fixedTime <= post.fixedTime) {
        throw new Error(`Post #${post.id}: comment and post on same day but comment time(${comment.fixedTime}) <= post time(${post.fixedTime})`);
      }

      const offSetDayComment = comment.offsetDays;
      const commentCreatedAt = resolveSeedDate(comment.offsetDays, comment.fixedTime);
      const createdComment = await commentModel.create({
        postId:     createdPost._id,
        authorId:   commentAuthorId,
        content:    comment.comment,
        likeCount:  comment.likeCount,
        replyCount: comment.replyCount,
        createdAt:  commentCreatedAt,
      });

      await activityRepo.create({
        type:      "COMMENT",
        content:   `New comment on ${post.user.name}'s post in ${postUniverse}`,
        universe:  postUniverse,
        postId:    String(createdPost._id),
        createdAt: commentCreatedAt,
      });

      if (!comment.replies?.length) continue;

      for (const reply of comment.replies) {
        const replyAuthorId = await upsertUser(userModel, reply.user);

        if (reply.offsetDays > offSetDayComment) {
          throw new Error(`Post #${post.id}: reply offsetDays(${reply.offsetDays}) > comment offsetDays(${offSetDayComment}) — reply is older than comment`);
        }
        if (reply.offsetDays === offSetDayComment && reply.fixedTime <= comment.fixedTime) {
          throw new Error(`Post #${post.id}: reply and comment on same day but reply time(${reply.fixedTime}) <= comment time(${comment.fixedTime})`);
        }

        await commentModel.create({
          postId:          createdPost._id,
          authorId:        replyAuthorId,
          content:         reply.comment,
          parentCommentId: createdComment._id,
          likeCount:       reply.likeCount,
          replyCount:      reply.replyCount ?? 0,
          createdAt:       resolveSeedDate(reply.offsetDays, reply.fixedTime),
        });
      }
    }
  }

  console.log("✅ Seed complete");
  process.exit(0);
}

async function upsertUser(
  userModel: UserModelType,
  userData: { email: string; name: string; photo: string; userName: string }
): Promise<string> {
  const { email, name, photo, userName } = userData;

  if (userCache.has(email)) return userCache.get(email)!;

  let user = await userModel.findOne({ email });
  if (!user) {
    user = await userModel.create({ email, name, photo, userName });
    console.log(`👤 Created user: ${name}`);
  }

  const id = String(user._id);
  userCache.set(email, id);
  return id;
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
