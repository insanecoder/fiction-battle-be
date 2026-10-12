import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { UNIVERSES, type Universe } from "../types/custom-types";

const characterStatsSchema = new Schema(
  {
    name:     { type: String, required: true },
    universe: { type: String, enum: UNIVERSES, required: true },
    posts:    { type: Number, default: 0 },
  },
  { versionKey: false }
);

characterStatsSchema.index({ name: 1, universe: 1 }, { unique: true });
characterStatsSchema.index({ posts: -1 });

export type CharacterStatsDocument = {
  _id:      string;
  name:     string;
  universe: Universe;
  posts:    number;
};

export type CharacterStatsModelType = Model<CharacterStatsDocument>;

export function createCharacterStatsModel(conn: DbConnection<Connection>): CharacterStatsModelType {
  return (
    (conn.native.models["CharacterStats"] as CharacterStatsModelType) ||
    conn.native.model<CharacterStatsDocument>("CharacterStats", characterStatsSchema)
  );
}
