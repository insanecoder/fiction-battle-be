import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger/logger";
import { getRouteLabel } from "./httpMiddleware";

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = performance.now();
  if (getRouteLabel(req) == "/metrics") {
    next()
    return
  }
  res.on("finish", () => {
    const latencyMs = Math.round(performance.now() - start);

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