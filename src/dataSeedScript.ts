import path from "path";
import fs from "fs/promises";
import { MongooseAdapter } from "./db/mongo-client";
import { createUserModel, UserModelType } from "./models/user.model";
import { createCommenttModel } from "./models/comment.model";
import { PostsRepository } from "./features/posts/posts.repository";
import { PostLikeRepository } from "./features/posts/post-like.repository";
import { TagRepository } from "./features/tags/tag.repository";
import { TagMappingRepository } from "./features/tags/tag-mapping.repository";
import { TagCandidateRepository } from "./features/tags/tag-candidate.repository";
import { TagService, tagEmbeddingText, type TagName } from "./features/tags/tag.service";
import { createEmbedder, type Embedder } from "./ai/embeddings/embedder";
import { VectorSearchService } from "./ai/vector-search/vector-search.service";
import { TagVerificationService } from "./ai/tag-verification/tag-verification.service";
import { LLMLogRepository } from "./ai/logging/llm-log.repository";
import { TAG_VECTOR_INDEX } from "./models/tag.model";
import { AnalyticsRepository } from "./features/analytics/analytics.repository";
import { ActivityRepository } from "./features/analytics/activity.repository";
import { AnalyticsService } from "./features/analytics/analytics.service";
import { TAG_TYPES, type TagType, type Universe } from "./types/custom-types";

const userCache = new Map<string, string>(); // email -> _id

type SeedTagDeps = { tagService: TagService; tagRepo: TagRepository; embedder: Embedder };

// Creates the Atlas vector index on tags.embedding if it's missing, then waits until it can be queried.
async function ensureTagVectorIndex(tagRepo: TagRepository, dimensions: number): Promise<void> {
  const collection = tagRepo.tagModel.collection;
  const [existing] = (await collection.listSearchIndexes(TAG_VECTOR_INDEX).toArray()) as any[];
  if (!existing) {
    await collection.createSearchIndex({
      name: TAG_VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
          { type: "filter", path: "type" },
          { type: "filter", path: "universe" },
        ],
      },
    });
    console.log(`   created ${TAG_VECTOR_INDEX} (${dimensions} dimensions)`);
  } else {
    const indexed = existing.latestDefinition?.fields?.find((f: any) => f.type === "vector")?.numDimensions;
    if (indexed && indexed !== dimensions) {
      throw new Error(`${TAG_VECTOR_INDEX} has ${indexed} dimensions but EMBEDDING_DIMENSIONS is ${dimensions}; drop the index in Atlas first`);
    }
  }
  for (let i = 0; i < 40; i++) {
    const [index] = (await collection.listSearchIndexes(TAG_VECTOR_INDEX).toArray()) as any[];
    if (index?.queryable && index.status === "READY") return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`${TAG_VECTOR_INDEX} not ready after 2 minutes; check it in Atlas`);
}

// Adds a seed tag to the vocabulary with its vector. Atlas indexes it a few seconds later, so a
// similar name resolved right after it may not find it yet.
async function createSeedTag({ tagRepo, embedder }: SeedTagDeps, name: TagName): Promise<{ id: string; label: string }> {
  const [vector] = await embedder.embed([tagEmbeddingText(name)]);
  const tag = await tagRepo.createWithEmbedding(name, vector, embedder.model);
  return { id: String(tag._id), label: tag.label };
}

// Resolves one seed tag through the same pipeline as a post's LLM tags (vocabulary → map → vector
// search → verification), except that a name nobody matches is created as a new tag instead of
// going to the review queue. Returns undefined for a tag that is skipped.
async function resolveSeedTag(deps: SeedTagDeps, name: TagName, postText: string): Promise<{ id: string; label: string } | undefined> {
  const result = await deps.tagService.resolveTags([name], { postText });

  const [resolved] = result.resolved;
  if (resolved) {
    if (resolved.how !== "vocabulary") console.log(`   🔗 "${name.label}" → "${resolved.tagLabel}" (${resolved.how})`);
    return { id: resolved.tagId, label: resolved.tagLabel };
  }

  const [review] = result.toReview;
  if (review?.reason === "llm_failed") {
    // Creating it anyway could add a duplicate, so stop; the seed wipes and starts over when rerun.
    throw new Error(`Verification failed for "${name.label}"; rerun the seed`);
  }
  if (review?.reason === "several_matches" || review?.reason === "contradictory") {
    const ones = review.answers.filter((a) => a.same === 1).map((a) => a.label);
    console.log(`   ⚠️  skipped "${name.label}" (${name.type}, ${name.universe}): looks like several tags (${ones.join(", ")})`);
    return undefined;
  }
  // Seed tags are all HP/GOT, so a "not in universe" answer is overruled.
  if (result.notInUniverse.length) console.log(`   ℹ️  "${name.label}" was judged not in universe; created anyway`);

  return createSeedTag(deps, name);
}

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

  // Seed tags go through the real tag pipeline, so the vocabulary is built without near-duplicates.
  const embedder = createEmbedder();
  if (!embedder) throw new Error("LLM_API_KEY is required to seed: tags need embeddings");
  const vectorSearch = new VectorSearchService();
  const tagService = new TagService(tagRepo, {
    mappingRepo:   new TagMappingRepository(dbConn),
    candidateRepo: new TagCandidateRepository(dbConn),
    vectorSearch,
    embedder,
    verification:  new TagVerificationService(new LLMLogRepository(dbConn)),
  });
  const seedTagDeps: SeedTagDeps = { tagService, tagRepo, embedder };

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
  await dbConn.native.collection("tag_mappings").deleteMany({});
  await dbConn.native.collection("tag_candidates").deleteMany({});
  await dbConn.native.collection("postlikes").deleteMany({});
  await analyticsDbConn.native.collection("universestats").deleteMany({});
  await analyticsDbConn.native.collection("characterstats").deleteMany({});
  await analyticsDbConn.native.collection("dailystats").deleteMany({});
  await analyticsDbConn.native.collection("activities").deleteMany({});

  console.log("🔎 Checking the Atlas vector index...");
  await ensureTagVectorIndex(tagRepo, embedder.dimensions);

  // Seed top-level users first and collect their IDs for distributing likes
  const allUserIds: string[] = [];
  for (const user of data.users) {
    const userId = await upsertUser(userModel, user);
    allUserIds.push(userId);
  }

  for (const post of data.posts) {
    const authorId = await upsertUser(userModel, post.user);

    // "universe" is "HP", "GOT", or ["HP", "GOT"] for a crossover post, whose tags then name
    // their own universe (defaulting to the post's first).
    const postUniverses: Universe[] = [].concat(post.universe);
    const postUniverseLabel = postUniverses.join(" & ");

    // The file's tags are treated as the tagging LLM's output for this post. They're resolved one at
    // a time, so a tag created for this post is already in the vocabulary for the next one.
    const names: TagName[] = (post.tags ?? [])
      .filter((t: any) => (TAG_TYPES as readonly string[]).includes(t.type) && t.label?.trim())
      .map((t: any) => ({ type: t.type as TagType, label: t.label.trim(), universe: (t.universe ?? postUniverses[0]) as Universe }));
    const resolvedTags: (TagName & { tag: { id: string; label: string } })[] = [];
    for (const name of names) {
      const tag = await resolveSeedTag(seedTagDeps, name, post.post);
      if (tag) resolvedTags.push({ ...name, tag });
    }
    const groupedIds: Record<TagType, string[]> = { person: [], place: [], artifact: [], event: [] };
    for (const t of resolvedTags) {
      if (!groupedIds[t.type].includes(t.tag.id)) groupedIds[t.type].push(t.tag.id);
    }

    const postCreatedAt = resolveSeedDate(post.offsetDays, post.fixedTime);

    const createdPost = await postRepo.create({
      authorId,
      content:      post.post,
      tags:         [groupedIds],
      universe:     postUniverses,
      likeCount:    post.likeCount,
      commentCount: post.commentCount,
      createdAt:    postCreatedAt,
    });

    console.log(`📝 Created post #${post.id}`);

    // A crossover post counts toward both sides; each side's character stats get only its own tags.
    for (const universe of postUniverses) {
      const personLabels = [...new Set(
        resolvedTags.filter((t) => t.type === "person" && t.universe === universe).map((t) => t.tag.label)
      )];
      await analyticsService.recordPostCreated(universe, personLabels, postCreatedAt);
      await analyticsService.recordBulkTotals(universe, post.likeCount ?? 0, post.commentCount ?? 0);
    }
    // Activity entries hold a single universe, so a crossover post's are left without one.
    const activityUniverse = postUniverses.length === 1 ? postUniverses[0] : undefined;
    await activityRepo.create({
      type:      "POST",
      content:   `New post by ${post.user.name} in ${postUniverseLabel}`,
      universe:  activityUniverse,
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
        content:   `Post by ${post.user.name} in ${postUniverseLabel} received ${likeCount} new likes`,
        universe:  activityUniverse,
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
        content:   `New comment on ${post.user.name}'s post in ${postUniverseLabel}`,
        universe:  activityUniverse,
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

  const tagCount = await dbConn.native.collection("tags").countDocuments();
  const mappingCount = await dbConn.native.collection("tag_mappings").countDocuments();
  console.log(`🏷️  Vocabulary: ${tagCount} tags, ${mappingCount} names mapped onto them`);
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
