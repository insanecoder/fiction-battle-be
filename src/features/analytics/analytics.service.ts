import { AnalyticsRepository } from "./analytics.repository";
import { ActivityRepository } from "./activity.repository";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Fixed to UTC — see the "Analytics UTC dates" project note. Requires the server
// process to run with TZ=UTC so this agrees with resolveCreatedAt() (posts.service.ts).
export function dateKeyUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class AnalyticsService {
  constructor(
    private readonly analyticsRepo: AnalyticsRepository,
    private readonly activityRepo:  ActivityRepository,
  ) {}

  // Post/comment/like handlers call these so the stats collections stay current —
  // getSummary() only ever reads the precomputed collections, it never rescans posts.
  async recordPostCreated(universe: "HP" | "GOT", personTagLabels: string[], createdAt: Date = new Date()): Promise<void> {
    await this.analyticsRepo.incrementPostCreated(universe, personTagLabels, dateKeyUTC(createdAt));
  }

  async recordLikeDelta(universe: "HP" | "GOT", delta: 1 | -1): Promise<void> {
    await this.analyticsRepo.incrementLikeDelta(universe, delta);
  }

  async recordCommentAdded(universe: "HP" | "GOT"): Promise<void> {
    await this.analyticsRepo.incrementCommentAdded(universe);
  }

  // Used only by the seed script — applies historical like/comment counts in one shot
  async recordBulkTotals(universe: "HP" | "GOT", likes: number, comments: number): Promise<void> {
    await this.analyticsRepo.incrementBulkTotals(universe, likes, comments);
  }

  async getSummary() {
    const universeStats = await this.analyticsRepo.getUniverseTotals();
    const statsByUniverse = new Map(universeStats.map((s) => [s._id, s]));
    const hp  = statsByUniverse.get("HP")  ?? { posts: 0, likes: 0, comments: 0 };
    const got = statsByUniverse.get("GOT") ?? { posts: 0, likes: 0, comments: 0 };

    const totalPosts = hp.posts + got.posts || 1;
    const universeShare = [
      { name: "HP" as const,  value: Math.round((hp.posts  / totalPosts) * 100) },
      { name: "GOT" as const, value: Math.round((got.posts / totalPosts) * 100) },
    ];

    const engagement = [
      { universe: "HP" as const,  likes: hp.likes,  comments: hp.comments },
      { universe: "GOT" as const, likes: got.likes, comments: got.comments },
    ];

    const hpEngagement  = hp.likes  + hp.comments;
    const gotEngagement = got.likes + got.comments;
    const leadingUniverse  = gotEngagement >= hpEngagement ? "GOT" : "HP";
    const trailingUniverse = leadingUniverse === "GOT" ? "HP" : "GOT";
    const leadingTotal  = leadingUniverse === "GOT" ? gotEngagement : hpEngagement;
    const trailingTotal = leadingUniverse === "GOT" ? hpEngagement : gotEngagement;
    const weeklyEngagementPct = trailingTotal === 0 ? 0 : Math.round(((leadingTotal - trailingTotal) / trailingTotal) * 100);

    const topCharacters = (await this.analyticsRepo.getTopCharacters(5))
      .map((c) => ({ name: c.name, posts: c.posts, universe: c.universe }));
    const topTag = topCharacters[0]?.name ?? "—";

    const now = new Date();
    const last7Dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - (6 - i));
      return dateKeyUTC(d);
    });
    const dailyDocs = await this.analyticsRepo.getDailyStats(last7Dates);
    const dailyMap = new Map(dailyDocs.map((d) => [d._id, d]));

    const today = dateKeyUTC(now);
    const todayCount = dailyMap.get(today);
    const postsToday = (todayCount?.hp ?? 0) + (todayCount?.got ?? 0);

    const weeklyMomentum = last7Dates.map((date) => {
      const entry = dailyMap.get(date);
      return { day: DAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()], hp: entry?.hp ?? 0, got: entry?.got ?? 0 };
    });

    const recentActivity = await this.activityRepo.findRecent(10);
    const liveActivity = recentActivity.map((a) => ({
      id:       String((a as any)._id),
      type:     a.type,
      text:     a.content,
      universe: a.universe,
      time:     (a as any).createdAt,
    }));

    return {
      battleStatus: {
        leadingUniverse,
        label: leadingUniverse === "HP" ? "Harry Potter is leading" : "Game of Thrones is leading",
        weeklyEngagementPct,
        comparedTo: trailingUniverse,
      },
      metrics: {
        postsToday,
        totalLikes:    hp.likes + got.likes,
        totalComments: hp.comments + got.comments,
        topTag,
      },
      topCharacters,
      universeShare,
      engagement,
      weeklyMomentum,
      liveActivity,
    };
  }
}
