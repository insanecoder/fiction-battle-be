import type { Connection } from "mongoose";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";
import { createTagMappingModel, tagNameKey, TagMappingDocument, TagMappingModelType, TagMappingSource } from "../../models/tag-mapping.model";
import type { TagType, Universe } from "../../types/custom-types";

type TagName = { type: TagType; label: string; universe: Universe };

export class TagMappingRepository {
  private readonly model: TagMappingModelType;

  constructor(conn: DbConnection<Connection>) {
    this.model = createTagMappingModel(conn);
  }

  // Mappings for these names (one indexed lookup per name, via the unique key).
  async findByNames(names: TagName[]): Promise<TagMappingDocument[]> {
    if (!names.length) return [];
    return observeDbOperation({ operation: "find", entity: "tag_mappings" }, () =>
      this.model.find({ $or: names.map((n) => ({ type: n.type, universe: n.universe, labelKey: tagNameKey(n.label) })) }).lean()
    );
  }

  // Saves "name → tag"; an existing mapping for the name is replaced.
  async save(name: TagName, tagId: string, source: TagMappingSource): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "tag_mappings" }, () =>
      this.model.updateOne(
        { type: name.type, universe: name.universe, labelKey: tagNameKey(name.label) },
        { $set: { tagId, source }, $setOnInsert: { label: name.label.trim() } },
        { upsert: true }
      )
    );
  }
}
