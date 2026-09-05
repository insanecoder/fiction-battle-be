import express from "express";
import cors from "cors";
import helmet from "helmet";
import { requestId } from "./lib/http/requestId";
import { errorMiddleware } from "./lib/http/errors";
import { logger } from "./lib/logger/logger";
import { registerRoutes } from "./routes/routes";
import { requestLoggingMiddleware } from "./observability/loggingMiddleware";
import { httpMetricsMiddleware } from "./observability/httpMiddleware";
import { register } from "./observability/metrics";
import { metricsAuthMiddleware } from "./observability/metricsAuth";
import { buildDependencies, generateDBObjs } from "./app-dependencies";
import { AppDependencies } from "./types/custom-types";
import { authMiddleware } from "./middlewares/auth";
import { RequestHandler } from "express";

export async function buildApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(requestId);

  app.use(express.json({ limit: "200kb" }));

  app.use(requestLoggingMiddleware)
  app.use(httpMetricsMiddleware)

  const dbObjs = await generateDBObjs()
  const appDependencies:AppDependencies = await buildDependencies(dbObjs)

  const auth:         RequestHandler = await authMiddleware(dbObjs.primary);
  const optionalAuth: RequestHandler = await authMiddleware(dbObjs.primary, { required: false });

  registerRoutes(app, appDependencies, auth, optionalAuth);

  app.get("/", (_req, res) => {
    res.type("html").send("<h1>Hello world! I'm a Node/Express Js web server...</h1>");
  });

  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.get("/readyz", (req, res) => res.json({ ok: true }));

  app.get("/metrics", metricsAuthMiddleware, async (_req, res) => {
    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
    },
  });
});
  app.use(errorMiddleware);
  return app;
}