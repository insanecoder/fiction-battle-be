import type { Request, Response, NextFunction } from "express";
import { AnalyticsService } from "./analytics.service";

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  getSummary = async (req: Request, res: Response, next: NextFunction) => {
    const summary = await this.analyticsService.getSummary();
    return res.status(200).json({ data: summary, requestId: req.requestId });
  };
}
