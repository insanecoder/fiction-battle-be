import type { Connection } from "mongoose";
import { createUniverseStatsModel, UniverseStatsDocument, UniverseStatsModelType } from "../../models/universe-stats.model";
import { createCharacterStatsModel, CharacterStatsDocument, CharacterStatsModelType } from "../../models/character-stats.model";
import { createDailyStatsModel, DailyStatsDocument, DailyStatsModelType } from "../../models/daily-stats.model";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";

type Universe = "HP" | "GOT";

export class AnalyticsRepository {
  private readonly universeStatsModel:  UniverseStatsModelType;
  private readonly characterStatsModel: CharacterStatsModelType;
  private readonly dailyStatsModel:     DailyStatsModelType;

  constructor(conn: DbConnection<Connection>) {
    this.universeStatsModel  = createUniverseStatsModel(conn);
    this.characterStatsModel = createCharacterStatsModel(conn);
    this.dailyStatsModel     = createDailyStatsModel(conn);
  }

  async getUniverseTotals(): Promise<UniverseStatsDocument[]> {
    return observeDbOperation({ operation: "find", entity: "universe_stats" }, () =>
      this.universeStatsModel.find({}).lean()
    );
  }

  async getTopCharacters(limit: number): Promise<CharacterStatsDocument[]> {
    return observeDbOperation({ operation: "find", entity: "character_stats" }, () =>
      this.characterStatsModel.find({}).sort({ posts: -1 }).limit(limit).lean()
    );
  }

  async getDailyStats(dateKeys: string[]): Promise<DailyStatsDocument[]> {
    return observeDbOperation({ operation: "find", entity: "daily_stats" }, () =>
      this.dailyStatsModel.find({ _id: { $in: dateKeys } }).lean()
    );
  }

  async incrementPostCreated(universe: Universe, personTagLabels: string[], dateKey: string): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "universe_stats" }, () =>
      this.universeStatsModel.updateOne(
        { _id: universe },
        { $inc: { posts: 1 } },
        { upsert: true }
      )
    );

    const dayField = universe === "GOT" ? "got" : "hp";
    await observeDbOperation({ operation: "update", entity: "daily_stats" }, () =>
      this.dailyStatsModel.updateOne(
        { _id: dateKey },
        { $inc: { [dayField]: 1 } },
        { upsert: true }
      )
    );

    for (const label of personTagLabels) {
      await observeDbOperation({ operation: "update", entity: "character_stats" }, () =>
        this.characterStatsModel.updateOne(
          { name: label, universe },
          { $inc: { posts: 1 } },
          { upsert: true }
        )
      );
    }
  }

  async incrementLikeDelta(universe: Universe, delta: 1 | -1): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "universe_stats" }, () =>
      this.universeStatsModel.updateOne(
        { _id: universe },
        { $inc: { likes: delta } },
        { upsert: true }
      )
    );
  }

  async incrementCommentAdded(universe: Universe): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "universe_stats" }, () =>
      this.universeStatsModel.updateOne(
        { _id: universe },
        { $inc: { comments: 1 } },
        { upsert: true }
      )
    );
  }

  // Used only by the seed script to bulk-apply historical like/comment counts in one shot
  async incrementBulkTotals(universe: Universe, likes: number, comments: number): Promise<void> {
    await this.universeStatsModel.updateOne(
      { _id: universe },
      { $inc: { likes, comments } },
      { upsert: true }
    );
  }
}
