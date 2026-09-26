import { describe, expect, it } from "vitest";
import type { RequestHandler } from "express";
import { registerScheduledAndIngestRoutes, type RegisteredIngestRoute } from "./ingestRouteRegistration";
import {
  scheduledAdCampaignsRefreshHandler,
  scheduledGitHubCprRefreshHandler,
  scheduledProductMetricsRefreshHandler,
  scheduledRankRefreshHandler,
} from "./scheduledRankHandler";

function createRouteApp() {
  const routes: RegisteredIngestRoute[] = [];
  const app = {
    get(path: string, handler: RequestHandler) {
      routes.push({ method: "get", path, handler });
      return app;
    },
    post(path: string, handler: RequestHandler) {
      routes.push({ method: "post", path, handler });
      return app;
    },
  };
  return { app, routes };
}

describe("scheduled and public ingest route registration", () => {
  it("registers the three requested public mirrors with their original handlers", () => {
    const { app, routes } = createRouteApp();
    registerScheduledAndIngestRoutes(app as never);

    expect(routes).toEqual(expect.arrayContaining([
      { method: "post", path: "/api/ingest/refreshDailyRank", handler: scheduledRankRefreshHandler },
      { method: "post", path: "/api/ingest/refreshProductMetrics", handler: scheduledProductMetricsRefreshHandler },
      { method: "post", path: "/api/ingest/githubCpr", handler: scheduledGitHubCprRefreshHandler },
    ]));
  });

  it("preserves the original scheduled routes alongside the external mirrors", () => {
    const { app, routes } = createRouteApp();
    registerScheduledAndIngestRoutes(app as never);

    expect(routes.map(route => `${route.method}:${route.path}`)).toEqual(expect.arrayContaining([
      "post:/api/scheduled/refreshDailyRank",
      "post:/api/scheduled/refreshProductMetrics",
      "post:/api/scheduled/githubCpr",
      "post:/api/ingest/refreshDailyRank",
      "post:/api/ingest/refreshProductMetrics",
      "post:/api/ingest/githubCpr",
    ]));
  });

  it("registers the ad campaign receiver on both scheduled and ingestion paths", () => {
    const { app, routes } = createRouteApp();
    registerScheduledAndIngestRoutes(app as never);

    expect(routes).toEqual(expect.arrayContaining([
      { method: "post", path: "/api/scheduled/refreshAdCampaigns", handler: scheduledAdCampaignsRefreshHandler },
      { method: "post", path: "/api/ingest/refreshAdCampaigns", handler: scheduledAdCampaignsRefreshHandler },
    ]));
  });
});
