import type { Request, Response, NextFunction } from "express";
import type { z } from "zod";
import { ZodError } from "zod";

type loc = "body" | "query" | "params";

export function validate(schema: z.ZodTypeAny, idx:loc) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const input = (req as any)[idx];
      const parsed = schema.parse(input);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const e: any = new Error("Validation failed");
        e.status = 400;
        e.code = "VALIDATION_ERROR";
        e.details = err.issues.map((i) => ({
          message: i.message,
          code: i.code,
        }));
        return next(e);
      }
      return next(err);
    }
  };
}