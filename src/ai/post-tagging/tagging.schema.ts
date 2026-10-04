import { z } from "zod";

export const UniverseSchema = z.enum(["HP", "GOT"]);

// Same tag types as models/tag.model.ts so results can go straight into TagService.
export const TagTypeSchema = z.enum(["person", "place", "artifact", "event"]);

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

export type Universe = z.infer<typeof UniverseSchema>;
export type PostTag = z.infer<typeof PostTagSchema>;
export type PostTagging = z.infer<typeof PostTaggingSchema>;
