import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger/logger";

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  res.on("finish", () => {
    const latencyMs = Date.now() - start;

    logger.info(
      {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latencyMs,
      },
      "request"
    );
  });

  next();
}