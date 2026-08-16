import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const universeStatsSchema = new Schema(
  {
    _id:      { type: String, enum: ["HP", "GOT"] }, // universe
    posts:    { type: Number, default: 0 },
    likes:    { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
  },
  { versionKey: false }
);

export type UniverseStatsDocument = {
  _id: "HP" | "GOT";
  posts: number;
  likes: number;
  comments: number;
};

export type UniverseStatsModelType = Model<UniverseStatsDocument>;

export function createUniverseStatsModel(conn: DbConnection<Connection>): UniverseStatsModelType {
  return (
    (conn.native.models["UniverseStats"] as UniverseStatsModelType) ||
    conn.native.model<UniverseStatsDocument>("UniverseStats", universeStatsSchema)
  );
}
