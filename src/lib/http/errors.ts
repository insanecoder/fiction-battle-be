import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger/logger";

export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, status: err.status, details: err.details }, err.message);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
  }
  const e = err instanceof Error ? err : new Error(String(err));
  logger.error({ requestId, "message":e.message, "stackTrace":e.stack }, "Unhandled error");
  return res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong", requestId } });
}