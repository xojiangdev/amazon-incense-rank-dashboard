import { Request, Response } from "express";
import { z } from "zod";
import { applyRealRankSnapshots, getRankTrackingTargets } from "./db";
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
        trackedRange: "top 60",
        notInTop60Rank: 61,
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
      marketplace: z.enum(["US", "CA"]),
      asin: z.string().min(10).max(10),
      keyword: z.string().min(1).max(255),
      rank: z.number().int().min(1).max(61),
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
