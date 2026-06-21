import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";

const tagSchema = new Schema({
  type:     { type: String, enum: ["person", "place", "artifact", "event"], required: true },
  label:    { type: String, required: true, trim: true },
  universe: { type: String, enum: ["HP", "GOT"], required: true },
});

tagSchema.index({ type: 1, label: 1, universe: 1 }, { unique: true });

export type TagDocument = {
  _id:      string;
  type:     "person" | "place" | "artifact" | "event";
  label:    string;
  universe: "HP" | "GOT";
};

export type TagModelType = Model<TagDocument>;

export function createTagModel(conn: DbConnection<Connection>): TagModelType {
  return conn.native.models["Tag"] ?? conn.native.model<TagDocument>("Tag", tagSchema);
}
