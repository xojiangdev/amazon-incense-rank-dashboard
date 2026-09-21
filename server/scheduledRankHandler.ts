import { Request, Response } from "express";
import { z } from "zod";
import { applyProductReviewMetrics, applyRealRankSnapshots, getListings, getRankTrackingTargets } from "./db";
import { sdk } from "./_core/sdk";

async function authorizeCronOrAdmin(req: Request) {
  const user = await sdk.authenticateRequest(req);
  if (!user.isCron && user.role !== "admin") {
    throw Object.assign(new Error("cron or admin only"), { statusCode: 403 });
  }
  return user;
}

export async function scheduledRankTargetsHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const targets = await getRankTrackingTargets();
    return res.json({
      ok: true,
      rules: {
        source: "Sorftime Amazon reverse ASIN traffic terms",
        organicOnly: true,
        trackedRange: "first 3 Amazon search-result pages",
        notInFirst3PagesRank: 999,
        exactKeywordMatch: true,
      },
      totals: {
        listings: targets.length,
        keywords: targets.reduce((sum, item) => sum + item.keywords.length, 0),
      },
      targets,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      error: error?.message || "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
}

export const rankPayloadSchema = z.object({
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  snapshots: z.array(
    z.object({
      marketplace: z.enum(["US", "CA", "JP"]),
      asin: z.string().min(10).max(10),
      keyword: z.string().min(1).max(255),
      rank: z.number().int().min(1).max(999),
      page: z.number().int().min(1).max(4).optional(),
    })
  ).min(1).max(1000),
});

export async function scheduledRankRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = rankPayloadSchema.parse(req.body);
    const result = await applyRealRankSnapshots(input.snapshotDate, input.snapshots);
    return res.json({ ok: true, result });
  } catch (error: any) {
    console.error("[ScheduledTask] Error in real rank refresh:", error);
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "Internal server error",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

export async function scheduledProductMetricTargetsHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const rows = await getListings();
    return res.json({
      ok: true,
      totals: { listings: rows.length },
      targets: rows.map(item => ({ marketplace: item.marketplace, asin: item.asin })),
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({ error: error?.message || "Internal server error" });
  }
}

export const productMetricsPayloadSchema = z.object({
  observedAt: z.string().datetime(),
  metrics: z.array(
    z.object({
      marketplace: z.enum(["US", "CA", "JP"]),
      asin: z.string().min(10).max(10),
      rating: z.number().min(0).max(5).nullable(),
      reviewCount: z.number().int().min(0).nullable(),
      source: z.enum(["sorftime_product_detail", "dataforseo_amazon_asin"]),
    })
  ).min(1).max(500),
});

export async function scheduledProductMetricsRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = productMetricsPayloadSchema.parse(req.body);
    const result = await applyProductReviewMetrics(input.metrics, new Date(input.observedAt));
    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "Internal server error",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
