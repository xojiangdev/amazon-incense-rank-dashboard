import { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applyAdCampaigns, applyAdOrders, applyFbaStockSnapshots, applyGitHubCprDocument, applyProductReviewMetrics, applyRealRankSnapshots, applySqpKeywordSelections, getListings, getRankTrackingTargets, recordGitHubCprSyncFailure } from "./db";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import { GITHUB_CPR_BRANCH, GITHUB_CPR_OWNER, GITHUB_CPR_PATH, GITHUB_CPR_RAW_URL, GITHUB_CPR_REPOSITORY, GITHUB_CPR_SOURCE_KEY, parseGitHubCprDocument } from "../shared/githubCpr";

export function isValidSiteIngestToken(providedValue: string | undefined, expectedValue = ENV.siteIngestToken) {
  const expected = expectedValue.trim();
  const provided = providedValue?.trim() ?? "";
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

async function authorizeCronOrAdmin(req: Request) {
  // A non-empty server-only SITE_INGEST_TOKEN is an additional machine-to-machine
  // authentication path. It is intentionally checked before session validation
  // so external collectors do not need a Manus session cookie.
  if (isValidSiteIngestToken(req.get("x-ingest-token"))) return { isCron: false, role: "site_ingest" };
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
      pcAdRank: z.number().int().min(1).max(999).nullable().optional(),
      pcSbvRank: z.number().int().min(1).max(999).nullable().optional(),
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

const marketplaceSchema = z.enum(["US", "CA", "JP"]);
const activeFbaCandidateSchema = z.object({
  marketplace: marketplaceSchema,
  asin: z.string().trim().regex(/^[A-Z0-9]{10}$/i, "Expected a 10-character ASIN"),
  sku: z.string().trim().min(1).max(100),
  title: z.string().trim().min(3).max(2000),
  category: z.enum(["incense_sticks", "incense_burner", "incense_holder"]),
  category_name: z.string().trim().min(1).max(120),
  image_url: z.string().trim().max(4096).default(""),
  price: z.string().trim().min(1).max(32),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  fba_stock: z.number().int().positive(),
  fba_inbound_working: z.number().int().min(0).default(0),
  fba_inbound_shipped: z.number().int().min(0).default(0),
  fba_inbound_receiving: z.number().int().min(0).default(0),
  fba_inbound_total: z.number().int().min(0),
  fulfillment_channel: z.literal("FBA"),
  listing_status: z.literal("Active"),
  source_report_id: z.string().trim().min(1).max(255),
}).strict();

export const fbaStockRefreshPayloadSchema = z.object({
  observedAt: z.string().datetime(),
  snapshots: z.array(z.object({
    marketplace: marketplaceSchema,
    source_row_count: z.number().int().min(0),
    candidates: z.array(activeFbaCandidateSchema).max(1000),
  }).strict()).min(1).max(3),
}).strict();

/**
 * Accepts complete FBA + Active + positive-stock marketplace snapshots. The
 * receiver never writes keyword, rank, ad/SBV, or CPR fields.
 */
export async function scheduledFbaStockRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = fbaStockRefreshPayloadSchema.parse(req.body);
    const result = await applyFbaStockSnapshots(input.snapshots.map(snapshot => ({
      marketplace: snapshot.marketplace,
      sourceRowCount: snapshot.source_row_count,
      candidates: snapshot.candidates.map(candidate => ({
        marketplace: candidate.marketplace,
        asin: candidate.asin,
        sku: candidate.sku,
        title: candidate.title,
        category: candidate.category,
        categoryName: candidate.category_name,
        imageUrl: candidate.image_url,
        price: candidate.price,
        currency: candidate.currency,
        fbaStock: candidate.fba_stock,
        fbaInboundWorking: candidate.fba_inbound_working,
        fbaInboundShipped: candidate.fba_inbound_shipped,
        fbaInboundReceiving: candidate.fba_inbound_receiving,
        fbaInboundTotal: candidate.fba_inbound_total,
        fulfillmentChannel: candidate.fulfillment_channel,
        listingStatus: candidate.listing_status,
        sourceReportId: candidate.source_report_id,
      })),
    })), new Date(input.observedAt));
    return res.json({ ok: true, result });
  } catch (error: any) {
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "FBA stock refresh failed",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

const sqpSelectionBasisSchema = z.enum(["sqp_purchase", "sqp_cart", "sqp_click", "title_fallback"]);
const sqpSelectedTermSchema = z.object({
  marketplace: marketplaceSchema,
  asin: z.string().trim().regex(/^[A-Z0-9]{10}$/i, "Expected a 10-character ASIN"),
  search_query: z.string().trim().min(1).max(255),
  search_query_score: z.number().finite().min(0),
  search_query_volume: z.number().int().min(0),
  asin_impression_count: z.number().int().min(0),
  asin_click_count: z.number().int().min(0),
  asin_cart_add_count: z.number().int().min(0),
  asin_purchase_count: z.number().int().min(0),
  asin_conversion_rate: z.number().finite().min(0).max(100),
  asin_purchase_share: z.number().finite().min(0).max(100),
  // Title fallbacks produced by scripts_import_sqp_keywords.ts intentionally
  // have no SQP reporting period, so an empty value is valid only as source
  // metadata; the evidence-tier validator forbids them from claiming clicks.
  start_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]),
  end_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]),
  selection_basis: sqpSelectionBasisSchema,
}).strict();

export const sqpKeywordsRefreshPayloadSchema = z.object({
  observedAt: z.string().datetime(),
  source: z.object({
    report_type: z.literal("GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT"),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  listings: z.array(z.object({
    marketplace: marketplaceSchema,
    asin: z.string().trim().regex(/^[A-Z0-9]{10}$/i, "Expected a 10-character ASIN"),
    terms: z.array(sqpSelectedTermSchema).min(6).max(20),
  }).strict()).min(1).max(500),
}).strict();

/**
 * Accepts a complete, pre-selected SQP core-keyword set for every currently
 * visible FBA listing. It validates evidence tiers and never alters rank,
 * advertising, SBV, CPR, or daily-snapshot values.
 */
export async function scheduledSqpKeywordsRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = sqpKeywordsRefreshPayloadSchema.parse(req.body);
    const result = await applySqpKeywordSelections({
      observedAt: new Date(input.observedAt),
      listings: input.listings.map(item => ({
        marketplace: item.marketplace,
        asin: item.asin,
        terms: item.terms.map(term => ({
          marketplace: term.marketplace,
          asin: term.asin,
          searchQuery: term.search_query,
          searchQueryScore: term.search_query_score,
          searchQueryVolume: term.search_query_volume,
          asinImpressionCount: term.asin_impression_count,
          asinClickCount: term.asin_click_count,
          asinCartAddCount: term.asin_cart_add_count,
          asinPurchaseCount: term.asin_purchase_count,
          asinConversionRate: term.asin_conversion_rate,
          asinPurchaseShare: term.asin_purchase_share,
          startDate: term.start_date,
          endDate: term.end_date,
          selectionBasis: term.selection_basis,
        })),
      })),
    });
    return res.json({ ok: true, source: input.source, result });
  } catch (error: any) {
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "SQP keyword refresh failed",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

const githubCprRepository = z.object({
  owner: z.literal(GITHUB_CPR_OWNER),
  repository: z.literal(GITHUB_CPR_REPOSITORY),
  branch: z.literal(GITHUB_CPR_BRANCH),
  path: z.literal(GITHUB_CPR_PATH),
});

export const githubCprPayloadSchema = z.object({
  repository: githubCprRepository,
  sha: z.string().regex(/^[a-f0-9]{40}$/i, "Expected a Git commit SHA"),
  updatedAt: z.string().datetime(),
  document: z.unknown(),
});

const githubCprUnavailablePayloadSchema = z.object({
  repository: githubCprRepository,
  reason: z.literal("file_not_found"),
  detail: z.string().min(1).max(1000),
});

/**
 * This endpoint accepts only the declared GitHub repository and is meant for
 * the daily connected-GitHub schedule. It never touches rank or advertising
 * fields; only an independently newer repository version can update CPR.
 */
export async function scheduledGitHubCprRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = githubCprPayloadSchema.parse(req.body);
    const document = parseGitHubCprDocument(input.document);
    const updatedAt = new Date(input.updatedAt);
    const result = await applyGitHubCprDocument({
      sourceKey: GITHUB_CPR_SOURCE_KEY,
      sourceUrl: GITHUB_CPR_RAW_URL,
      remoteSha: input.sha,
      remoteUpdatedAt: updatedAt,
      document,
    });
    return res.json({ ok: true, repository: input.repository, result });
  } catch (error: any) {
    const message = error?.message || "GitHub CPR refresh failed";
    try {
      await recordGitHubCprSyncFailure({ sourceKey: GITHUB_CPR_SOURCE_KEY, sourceUrl: GITHUB_CPR_RAW_URL, error: message });
    } catch (recordError) {
      console.error("[ScheduledTask] Failed to record GitHub CPR error:", recordError);
    }
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: message,
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}


const adMetricsSchema = z.object({
  cost: z.number().min(0),
  sales: z.number().min(0),
  orders: z.number().int().min(0),
  clicks: z.number().int().min(0),
  impressions: z.number().int().min(0),
}).strict();

const adCampaignBucketSchema = z.enum([
  "auto",
  "keyword",
  "product",
  "category",
  "sb_brand",
  "sbv_kw",
  "sbv_prod",
  "sbv_cat",
  "sbv_other",
  "sd_views",
  "sd_prod",
  "sd_cat",
]);

export const adCampaignsPayloadSchema = z.object({
  observedAt: z.string().datetime(),
  marketplace: z.enum(["US", "CA", "JP"]),
  campaigns: z.array(z.object({
    campaignId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(255),
    state: z.string().trim().min(1).max(32),
    budget: z.number().nullable().optional(),
    targetingType: z.string().nullable().optional(),
    bucket: adCampaignBucketSchema.nullable().optional(),
    asins: z.array(z.string().trim().regex(/^[A-Z0-9]{10}$/i)).max(200),
    adGroups: z.array(z.object({
      name: z.string().trim().min(1).max(255),
      d7: adMetricsSchema,
      d30: adMetricsSchema,
    })).max(200),
    summary: z.object({
      endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
      yesterday: adMetricsSchema,
      d7: adMetricsSchema,
      d30: adMetricsSchema,
      acosY: z.number().nullable(),
      acos7: z.number().nullable(),
      acos30: z.number().nullable(),
      acosPrev7: z.number().nullable(),
    }).strict(),
  })).min(0).max(1000),
}).strict();

/**
 * 广告系列监控快照写入(三站 ACTIVE 系列 30天日报聚合)。
 */
export async function scheduledAdCampaignsRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = adCampaignsPayloadSchema.parse(req.body);
    const result = await applyAdCampaigns(input.marketplace, input.campaigns as never, new Date(input.observedAt));
    return res.json({ ok: true, result });
  } catch (error: any) {
    console.error("[ScheduledTask] Error in ad campaigns refresh:", error);
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "Internal server error",
      issues: error instanceof z.ZodError ? error.issues : undefined,
    });
  }
}

export const adOrdersPayloadSchema = z.object({
  observedAt: z.string().datetime(),
  marketplace: z.enum(["US", "CA", "JP"]),
  terms: z.array(z.object({
    asin: z.string().trim().regex(/^[A-Z0-9]{10}$/i, "Expected a 10-character ASIN"),
    keyword: z.string().trim().min(1).max(255),
    adPurchases: z.number().int().min(0).max(9999),
  })).min(1).max(2000),
}).strict();

/**
 * 关键词广告单(搜索词报表)写入：仅关键词定向广告,ASIN定向广告不产生搜索词,
 * 天然不在此报表。未出现在报表中的词视为未投放,广告单清空显示"—"。
 */
export async function scheduledAdOrdersRefreshHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = adOrdersPayloadSchema.parse(req.body);
    const result = await applyAdOrders(input.marketplace, input.terms, new Date(input.observedAt));
    return res.json({ ok: true, result });
  } catch (error: any) {
    console.error("[ScheduledTask] Error in ad orders refresh:", error);
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "Internal server error",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

/** Records a checked-but-missing source without changing any keyword metrics. */
export async function scheduledGitHubCprUnavailableHandler(req: Request, res: Response) {
  try {
    await authorizeCronOrAdmin(req);
    const input = githubCprUnavailablePayloadSchema.parse(req.body);
    await recordGitHubCprSyncFailure({
      sourceKey: GITHUB_CPR_SOURCE_KEY,
      sourceUrl: GITHUB_CPR_RAW_URL,
      error: input.detail,
      status: "file_not_found",
    });
    return res.json({ ok: true, repository: input.repository, status: "file_not_found" });
  } catch (error: any) {
    return res.status(error?.statusCode || (error instanceof z.ZodError ? 400 : 500)).json({
      error: error?.message || "GitHub CPR unavailable callback failed",
      issues: error instanceof z.ZodError ? error.issues : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
