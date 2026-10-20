import { Schema, Connection, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { TAG_TYPES, UNIVERSES, type TagType, type Universe } from "../types/custom-types";

const tagSchema = new Schema({
  type:     { type: String, enum: TAG_TYPES, required: true },
  label:    { type: String, required: true, trim: true },
  universe: { type: String, enum: UNIVERSES, required: true },
  // Vector of the tag for Atlas Vector Search (index TAG_VECTOR_INDEX). Never returned by
  // default: it's 768 numbers per tag.
  embedding:      { type: [Number], default: undefined, select: false },
  embeddingModel: { type: String, select: false },
});

tagSchema.index({ type: 1, label: 1, universe: 1 }, { unique: true });

// Atlas Vector Search index on tags.embedding, with type and universe as filter fields.
export const TAG_VECTOR_INDEX = "tag_embedding_index";

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
