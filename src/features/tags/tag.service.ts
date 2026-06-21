import { TagRepository } from "./tag.repository";
import { TagDocument } from "../../models/tag.model";

type TagInput = { type: "person" | "place" | "artifact" | "event"; label: string; universe: "HP" | "GOT" };
type GroupedTagIds = { person: string[]; place: string[]; artifact: string[]; event: string[] };

export class TagService {
  constructor(private readonly tagRepo: TagRepository) {}

  async searchTags(search: string, type?: string, universe?: string): Promise<TagDocument[]> {
    if (!search) {
      return this.tagRepo.findAll(type, universe);
    }
    return this.tagRepo.searchByLabel(search, type, universe);
  }

  async findTagsByIds(ids: string[]): Promise<TagDocument[]> {
    return this.tagRepo.findByIds(ids);
  }

  async upsertTagsAndGetGroupedIds(rawTags: TagInput[]): Promise<GroupedTagIds> {
    const docs = await this.tagRepo.upsertManyAndReturnDocs(rawTags);
    const grouped: GroupedTagIds = { person: [], place: [], artifact: [], event: [] };
    for (const doc of docs) {
      grouped[doc.type].push(String(doc._id));
    }
    return grouped;
  }
}
