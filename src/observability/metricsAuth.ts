import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { required } from "../config/env-utils";

const METRICS_TOKEN = required("METRICS_TOKEN");

function matchesToken(provided: string): boolean {
  const expected = Buffer.from(METRICS_TOKEN);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function metricsAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || !matchesToken(token)) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid metrics token", requestId: req.requestId },
    });
  }

  next();
}
