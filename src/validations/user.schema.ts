import { z } from "zod";

export const createUserSchema = z.object({
  email: z.email("Valid email is required"),
  name: z.string().min(1, "name is required"),
  picture: z.url("picture must be a valid URL").optional().or(z.literal("")),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;