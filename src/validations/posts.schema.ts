import { z } from "zod";

const MAX_WORDS = 200;
const UniverseEnum = z.enum(["GOT", "HP"]);

const tagArray = z
  .array(z.string().trim().min(1).max(100))
  .max(10)
  .optional();

export const postsFilterSchema = z.object({
  text:      z.string().trim().min(1).max(200).optional(),
  universe:  z.array(UniverseEnum).min(1).max(2).optional(),
  person:    tagArray,
  place:     tagArray,
  events:    tagArray,
  artifacts: tagArray,
  page:      z.number().int().min(1).default(1),
  pageSize:  z.number().int().min(1).max(50).default(20),
});

export type PostsFilterBody = z.infer<typeof postsFilterSchema>;


function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const rawTagSchema = z.object({
  type:  z.enum(["person", "place", "artifact", "event"]),
  label: z.string().trim().min(1).max(100),
});

export const createPostSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .refine((v) => wordCount(v) <= MAX_WORDS, {
      message: `Content must be ${MAX_WORDS} words or fewer`,
    }),
  universe:        UniverseEnum,
  tags:            z.array(rawTagSchema).max(10).optional(),
  clientRequestId: z.uuid().optional(),
});

export type CreatePostBody = z.infer<typeof createPostSchema>;