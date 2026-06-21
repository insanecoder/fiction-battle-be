import { Connection } from "mongoose";
import { createTagModel, TagDocument, TagModelType } from "../../models/tag.model";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";

export class TagRepository {
  private readonly tagModel: TagModelType;

  constructor(conn: DbConnection<Connection>) {
    this.tagModel = createTagModel(conn);
  }

  async findAll(type : "person" | "place" | "artifact" | "event", universe : "HP"|"GOT"[]) {
    console.log(type, universe)
    return observeDbOperation({ operation: "find", entity: "tagsAll" }, () => {
      let query:Record<string, unknown> = {"type":type}
      if (universe) {
        query.universe = universe
      }
      console.log(query)
      return this.tagModel.find(query).lean()
    }
    );
  }

  async searchByLabel(search: string, type?: string, universe?: string): Promise<TagDocument[]> {
    return observeDbOperation({ operation: "find", entity: "tagsByLabel" }, () => {
      let query: Record<string, unknown> = { label: { $regex: search, $options: "i" } };
      if (type)     query.type     = type;
      if (universe) query.universe = universe;
      return this.tagModel.find(query).lean() as Promise<TagDocument[]>;
    });
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
