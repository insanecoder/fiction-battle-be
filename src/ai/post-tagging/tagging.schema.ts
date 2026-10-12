import { z } from "zod";
import { TAG_TYPES, UNIVERSES } from "../../types/custom-types";

// Built from the DB enums, so a new universe or tag type flows into the LLM's output schema.
// The prompt text also names them, so add a new prompt version when they change.
export const UniverseSchema = z.enum(UNIVERSES);
export const TagTypeSchema = z.enum(TAG_TYPES);

export const PostTagSchema = z.object({
  type: TagTypeSchema,
  tag: z.string().describe("Canonical full name, e.g. 'Albus Dumbledore', not 'Dumbledore'"),
  universe: UniverseSchema,
});

export const PostTaggingSchema = z.object({
  universe: z
    .array(UniverseSchema)
    .describe("Universes the post is about: [], ['HP'], ['GOT'] or ['HP', 'GOT']"),
  confidence_in_universe: z
    .number()
    .describe("0 to 1: how confident you are in the universe list"),
  tags: z.array(PostTagSchema),
});

export type PostTag = z.infer<typeof PostTagSchema>;
export type PostTagging = z.infer<typeof PostTaggingSchema>;
