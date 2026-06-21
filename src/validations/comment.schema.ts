import { z } from "zod";

export const addCommentSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export const addReplySchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

export type AddCommentBody = z.infer<typeof addCommentSchema>;
export type AddReplyBody   = z.infer<typeof addReplySchema>;
