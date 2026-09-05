import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger/logger";
import { getRouteLabel } from "./httpMiddleware";

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
        path: getRouteLabel(req),
        status: res.statusCode,
        latencyMs,
      },
      "request"
    );
  });

  next();
}