import type { Express, RequestHandler } from "express";
import {
  scheduledFbaStockRefreshHandler,
  scheduledGitHubCprRefreshHandler,
  scheduledGitHubCprUnavailableHandler,
  scheduledProductMetricsRefreshHandler,
  scheduledProductMetricTargetsHandler,
  scheduledRankRefreshHandler,
  scheduledRankTargetsHandler,
  scheduledSqpKeywordsRefreshHandler,
  scheduledAdOrdersRefreshHandler,
} from "./scheduledRankHandler";

type RouteApp = Pick<Express, "get" | "post">;

/**
 * Registers internal Manus cron routes and their public, token-authenticated
 * mirrors. The production gateway reserves `/api/scheduled/*`, so external
 * collectors must use the corresponding `/api/ingest/*` paths.
 */
export function registerScheduledAndIngestRoutes(app: RouteApp) {
  app.get("/api/scheduled/rankTargets", scheduledRankTargetsHandler);
  app.post("/api/scheduled/refreshDailyRank", scheduledRankRefreshHandler);
  app.get("/api/scheduled/productMetricTargets", scheduledProductMetricTargetsHandler);
  app.post("/api/scheduled/refreshProductMetrics", scheduledProductMetricsRefreshHandler);
  app.post("/api/scheduled/githubCpr", scheduledGitHubCprRefreshHandler);
  app.post("/api/scheduled/githubCprUnavailable", scheduledGitHubCprUnavailableHandler);
  app.post("/api/scheduled/refreshFbaStock", scheduledFbaStockRefreshHandler);
  app.post("/api/scheduled/refreshSqpKeywords", scheduledSqpKeywordsRefreshHandler);
  app.post("/api/scheduled/refreshAdOrders", scheduledAdOrdersRefreshHandler);

  app.get("/api/ingest/rankTargets", scheduledRankTargetsHandler);
  app.post("/api/ingest/refreshDailyRank", scheduledRankRefreshHandler);
  app.post("/api/ingest/refreshProductMetrics", scheduledProductMetricsRefreshHandler);
  app.post("/api/ingest/githubCpr", scheduledGitHubCprRefreshHandler);
  app.post("/api/ingest/refreshFbaStock", scheduledFbaStockRefreshHandler);
  app.post("/api/ingest/refreshSqpKeywords", scheduledSqpKeywordsRefreshHandler);
  app.post("/api/ingest/refreshAdOrders", scheduledAdOrdersRefreshHandler);
}

export type RegisteredIngestRoute = {
  method: "get" | "post";
  path: string;
  handler: RequestHandler;
};
