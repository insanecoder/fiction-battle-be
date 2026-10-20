import type { Model, PipelineStage } from "mongoose";
import { observeDbOperation } from "../../observability/dbObservability";

export type VectorSearchQuery = {
  // Atlas Vector Search index on the collection, and the field it indexes.
  index: string;
  path: string;
  vector: number[];
  // Only fields declared as "filter" in the index can be used here.
  filter?: Record<string, unknown>;
  limit: number;
  // Fields to return besides _id and score, e.g. { label: 1 }.
  fields?: Record<string, 1>;
};

// score is Atlas's similarity score: 0..1 for cosine, higher is closer.
export type VectorSearchHit<T> = T & { _id: string; score: number };

// Nearest-neighbour search over any collection with an Atlas Vector Search index.
// Takes a vector, not text: callers embed the text first (src/ai/embeddings).
// Only works on Atlas; a local mongod has no $vectorSearch.
export class VectorSearchService {
  async search<T = {}>(model: Model<any>, query: VectorSearchQuery): Promise<VectorSearchHit<T>[]> {
    return observeDbOperation({ operation: "vectorSearch", entity: model.collection.name }, async () => {
      const pipeline = [
        {
          $vectorSearch: {
            index: query.index,
            path: query.path,
            queryVector: query.vector,
            // Candidates Atlas considers before picking the top `limit`; 10x is Atlas's usual guidance.
            numCandidates: Math.max(50, query.limit * 10),
            limit: query.limit,
            ...(query.filter ? { filter: query.filter } : {}),
          },
        },
        { $project: { ...query.fields, score: { $meta: "vectorSearchScore" } } },
      ] as PipelineStage[];
      const rows = await model.aggregate(pipeline);
      return rows.map((r) => ({ ...r, _id: String(r._id) })) as VectorSearchHit<T>[];
    });
  }
}
