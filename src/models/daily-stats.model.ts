import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

// _id is a UTC "YYYY-MM-DD" date key — see dateKeyUTC() in analytics.service.ts.
// Requires the server process to run with TZ=UTC so this stays consistent with
// resolveCreatedAt() (posts.service.ts), which resolves seeded post dates in local time.
const dailyStatsSchema = new Schema(
  {
    _id: { type: String },
    hp:  { type: Number, default: 0 },
    got: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export type DailyStatsDocument = {
  _id: string;
  hp:  number;
  got: number;
};

export type DailyStatsModelType = Model<DailyStatsDocument>;

export function createDailyStatsModel(conn: DbConnection<Connection>): DailyStatsModelType {
  return (
    (conn.native.models["DailyStats"] as DailyStatsModelType) ||
    conn.native.model<DailyStatsDocument>("DailyStats", dailyStatsSchema)
  );
}
