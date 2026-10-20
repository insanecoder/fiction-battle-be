import { Schema, Types } from "mongoose";
import type { Connection, InferSchemaType, Model } from "mongoose";
import { DbConnection } from "../db/database-client";
import { TAG_TYPES, UNIVERSES } from "../types/custom-types";

// Who decided the mapping: the seed's duplicate check, the verification LLM, or a reviewer.
export const TAG_MAPPING_SOURCES = ["seed", "llm", "review"] as const;
export type TagMappingSource = (typeof TAG_MAPPING_SOURCES)[number];

// A name that isn't a vocabulary label, mapped to the vocabulary tag it means:
// "The Imp" (person, GOT) → Tyrion Lannister. Not a tag itself, so the vocabulary stays one tag per
// entity; the next "The Imp" is found here instead of going through vector search and the LLM again.
const tagMappingSchema = new Schema(
  {
    type:     { type: String, enum: TAG_TYPES, required: true },
    universe: { type: String, enum: UNIVERSES, required: true },
    labelKey: { type: String, required: true }, // tagNameKey(label): the lookup key
    label:    { type: String, required: true }, // as first seen
    tagId:    { type: Schema.Types.ObjectId, ref: "Tag", required: true, index: true },
    source:   { type: String, enum: TAG_MAPPING_SOURCES, required: true },
  },
  { collection: "tag_mappings", timestamps: true, versionKey: false }
);

tagMappingSchema.index({ type: 1, universe: 1, labelKey: 1 }, { unique: true });

export type TagMappingDocument = InferSchemaType<typeof tagMappingSchema> & { _id: Types.ObjectId };
export type TagMappingModelType = Model<TagMappingDocument>;

export function createTagMappingModel(conn: DbConnection<Connection>): TagMappingModelType {
  return (conn.native.models.TagMapping as TagMappingModelType) || conn.native.model<TagMappingDocument>("TagMapping", tagMappingSchema);
}

// "  The   Imp " → "the imp". How names are compared everywhere: case and extra spaces don't matter.
export function tagNameKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
