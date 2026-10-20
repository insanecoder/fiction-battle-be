import { Connection } from "mongoose";
import { createTagModel, TagDocument, TagModelType } from "../../models/tag.model";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";
import type { TagType, Universe } from "../../types/custom-types";

type TagInput = { type: TagType; label: string; universe: Universe };

export class TagRepository {
  // Public so TagService can run vector search on the collection (VectorSearchService takes a model).
  readonly tagModel: TagModelType;

  constructor(conn: DbConnection<Connection>) {
    this.tagModel = createTagModel(conn);
  }

  async findAll(type?: string, universe?: string): Promise<TagDocument[]> {
    return observeDbOperation({ operation: "find", entity: "tagsAll" }, () => {
      const query: Record<string, unknown> = {};
      if (type)     query.type     = type;
      if (universe) query.universe = universe;
      return this.tagModel.find(query).lean() as Promise<TagDocument[]>;
    });
  }

  async searchByLabel(search: string, type?: string, universe?: string): Promise<TagDocument[]> {
    return observeDbOperation({ operation: "find", entity: "tagsByLabel" }, () => {
      let query: Record<string, unknown> = { label: { $regex: search, $options: "i" } };
      if (type)     query.type     = type;
      if (universe) query.universe = universe;
      return this.tagModel.find(query).lean() as Promise<TagDocument[]>;
    });
  }

  // Vocabulary tags with exactly these labels, ignoring case ("tyrion lannister" finds "Tyrion Lannister").
  async findByLabels(names: TagInput[]): Promise<TagDocument[]> {
    if (!names.length) return [];
    return observeDbOperation({ operation: "find", entity: "tagsByLabel" }, () =>
      this.tagModel
        .find({ $or: names.map((n) => ({ type: n.type, universe: n.universe, label: n.label.trim() })) })
        .collation({ locale: "en", strength: 2 })
        .lean() as Promise<TagDocument[]>
    );
  }

  async findByIds(ids: string[]): Promise<TagDocument[]> {
    return observeDbOperation({ operation: "find", entity: "tagsById" }, () =>
      this.tagModel.find({ _id: { $in: ids } }).lean() as Promise<TagDocument[]>
    );
  }

  async upsertManyAndReturnDocs(tags: TagInput[]): Promise<TagDocument[]> {
    const results: TagDocument[] = [];
    for (const tag of tags) {
      const doc = await this.tagModel
        .findOneAndUpdate(
          { type: tag.type, label: tag.label, universe: tag.universe },
          { $setOnInsert: { type: tag.type, label: tag.label, universe: tag.universe } },
          { upsert: true, new: true }
        )
        .lean();
      if (doc) results.push(doc as unknown as TagDocument);
    }
    return results;
  }

  async bulkUpsert(tags: TagInput[]) {
    const ops = tags.map((t) => ({
      updateOne: {
        filter: { type: t.type, label: t.label, universe: t.universe },
        update: { $setOnInsert: { type: t.type, label: t.label, universe: t.universe } },
        upsert: true,
      },
    }));
    return this.tagModel.bulkWrite(ops, { ordered: false });
  }
}
