import { Router } from "express";
import { AnalyticsController } from "../features/analytics/analytics.controller";

export function analyticsRouter(analyticsController: AnalyticsController): Router {
  const router = Router();
  router.get("/summary", analyticsController.getSummary);
  return router;
}
