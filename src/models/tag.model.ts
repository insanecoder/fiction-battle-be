import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { TAG_TYPES, UNIVERSES, type TagType, type Universe } from "../types/custom-types";

const tagSchema = new Schema({
  type:     { type: String, enum: TAG_TYPES, required: true },
  label:    { type: String, required: true, trim: true },
  universe: { type: String, enum: UNIVERSES, required: true },
});

tagSchema.index({ type: 1, label: 1, universe: 1 }, { unique: true });

export type TagDocument = {
  _id:      string;
  type:     TagType;
  label:    string;
  universe: Universe;
};

export type TagModelType = Model<TagDocument>;

export function createTagModel(conn: DbConnection<Connection>): TagModelType {
  return conn.native.models["Tag"] ?? conn.native.model<TagDocument>("Tag", tagSchema);
}
