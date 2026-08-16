import { Connection } from "mongoose";
import { DatabaseConnPools } from "../types/custom-types";
import { AnalyticsRepository } from "../features/analytics/analytics.repository";
import { ActivityRepository } from "../features/analytics/activity.repository";
import { AnalyticsService } from "../features/analytics/analytics.service";
import { AnalyticsController } from "../features/analytics/analytics.controller";

export function buildAnalyticsModule(dbConnPool: DatabaseConnPools<Connection>) {
  const conn = dbConnPool["analytics"];

  const analyticsRepo = new AnalyticsRepository(conn);
  const activityRepo  = new ActivityRepository(conn);

  const analyticsService    = new AnalyticsService(analyticsRepo, activityRepo);
  const analyticsController = new AnalyticsController(analyticsService);

  return { analyticsController, analyticsService, activityRepo };
}
