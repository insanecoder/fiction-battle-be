import { Request, Response, NextFunction } from "express";
import { httpRequestsTotal, httpRequestDurationSeconds } from "./metrics";

export function getRouteLabel(req: Request): string {
  if (req.baseUrl && req.route?.path) {
    return `${req.baseUrl}${req.route.path}`;
  }

  if (req.route?.path) {
    return String(req.route.path);
  }

  return req.path || "unknown";
}

export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = performance.now();

  res.on("finish", () => {
    const durationSeconds = (performance.now() - start) / 1000;

    const labels = {
      method: req.method,
      route: getRouteLabel(req),
      status: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });

  next();
}