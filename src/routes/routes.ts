import { Express, RequestHandler } from "express";
import { postsRouter } from "./posts.router";
import { AppDependencies } from "../types/custom-types";
import { userRouter } from "./user.router";
import { analyticsRouter } from "./analytics.router";

export function registerRoutes(app: Express, appDependencies: AppDependencies, auth: RequestHandler, optionalAuth: RequestHandler) {
  app.use("/v1/posts", postsRouter(appDependencies['post'], auth, optionalAuth, appDependencies['post']['tagController']));
  app.use("/v1/user", userRouter(appDependencies['user']));
  app.use("/v1/analytics", analyticsRouter(appDependencies['analytics']['analyticsController']));
}