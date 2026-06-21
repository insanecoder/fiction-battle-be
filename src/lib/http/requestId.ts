import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const rid = (req.header("x-request-id") ?? "").trim() || randomUUID();
  req.requestId = rid;
  req.startAt = Date.now();
  res.setHeader("x-request-id", rid);
  next();
}