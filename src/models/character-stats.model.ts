import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const characterStatsSchema = new Schema(
  {
    name:     { type: String, required: true },
    universe: { type: String, enum: ["HP", "GOT"], required: true },
    posts:    { type: Number, default: 0 },
  },
  { versionKey: false }
);

characterStatsSchema.index({ name: 1, universe: 1 }, { unique: true });
characterStatsSchema.index({ posts: -1 });

export type CharacterStatsDocument = {
  _id:      string;
  name:     string;
  universe: "HP" | "GOT";
  posts:    number;
};

export type CharacterStatsModelType = Model<CharacterStatsDocument>;

export function createCharacterStatsModel(conn: DbConnection<Connection>): CharacterStatsModelType {
  return (
    (conn.native.models["CharacterStats"] as CharacterStatsModelType) ||
    conn.native.model<CharacterStatsDocument>("CharacterStats", characterStatsSchema)
  );
}
