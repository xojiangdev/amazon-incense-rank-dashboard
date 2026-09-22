import { describe, expect, it } from "vitest";
import { fbaStockRefreshPayloadSchema, isValidSiteIngestToken, productMetricsPayloadSchema, rankPayloadSchema, sqpKeywordsRefreshPayloadSchema } from "./scheduledRankHandler";

describe("rankPayloadSchema", () => {
  it("accepts a valid real organic rank payload", () => {
    const parsed = rankPayloadSchema.parse({
      snapshotDate: "2026-09-21",
      snapshots: [
        { marketplace: "US", asin: "B0GWVDR845", keyword: "pine cone incense", rank: 7, pcAdRank: 2, pcSbvRank: null },
        { marketplace: "CA", asin: "B0FY6HB74X", keyword: "sandalwood incense sticks", rank: 999, page: 4 },
        { marketplace: "JP", asin: "B0H7WQKSMR", keyword: "ヒノキ 線香", rank: 136, page: 3, pcAdRank: 5, pcSbvRank: 1 },
      ],
    });
    expect(parsed.snapshots).toHaveLength(3);
    expect(parsed.snapshots[1]?.rank).toBe(999);
    expect(parsed.snapshots[0]?.pcAdRank).toBe(2);
    expect(parsed.snapshots[2]?.pcSbvRank).toBe(1);
  });

  it("rejects invalid dates, marketplaces, ASINs, and ranks", () => {
    const result = rankPayloadSchema.safeParse({
      snapshotDate: "09/21/2026",
      snapshots: [{ marketplace: "DE", asin: "short", keyword: "incense", rank: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty batches so scheduled retries cannot erase a valid day", () => {
    const result = rankPayloadSchema.safeParse({ snapshotDate: "2026-09-21", snapshots: [] });
    expect(result.success).toBe(false);
  });
});

describe("productMetricsPayloadSchema", () => {
  it("accepts exact marketplace review metrics and explicit no-review values", () => {
    const parsed = productMetricsPayloadSchema.parse({
      observedAt: "2026-09-21T08:45:00.000Z",
      metrics: [
        { marketplace: "US", asin: "B0FY67W88Z", rating: 4.2, reviewCount: 18, source: "sorftime_product_detail" },
        { marketplace: "JP", asin: "B0H7WQKSMR", rating: null, reviewCount: null, source: "sorftime_product_detail" },
      ],
    });
    expect(parsed.metrics).toHaveLength(2);
  });

  it("rejects ratings above five and negative review counts", () => {
    const result = productMetricsPayloadSchema.safeParse({
      observedAt: "2026-09-21T08:45:00.000Z",
      metrics: [{ marketplace: "US", asin: "B0FY67W88Z", rating: 5.5, reviewCount: -1, source: "sorftime_product_detail" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("site ingest authentication", () => {
  it("accepts only an exact non-empty configured token", () => {
    expect(isValidSiteIngestToken("fixed-ingest-token", "fixed-ingest-token")).toBe(true);
    expect(isValidSiteIngestToken("incorrect", "fixed-ingest-token")).toBe(false);
    expect(isValidSiteIngestToken(undefined, "fixed-ingest-token")).toBe(false);
    expect(isValidSiteIngestToken("fixed-ingest-token", "")).toBe(false);
  });
});

describe("FBA stock ingest contract", () => {
  const validFbaCandidate = {
    marketplace: "US",
    asin: "B0GWVDR845",
    sku: "pineconehy",
    title: "Natural Pine Cone Incense Sticks",
    category: "incense_sticks",
    category_name: "Incense products",
    image_url: "",
    price: "19.99",
    currency: "USD",
    fba_stock: 42,
    fba_inbound_working: 2,
    fba_inbound_shipped: 3,
    fba_inbound_receiving: 1,
    fba_inbound_total: 6,
    fulfillment_channel: "FBA",
    listing_status: "Active",
    source_report_id: "report-20260922",
  };

  it("accepts the existing FBA candidate field structure", () => {
    const parsed = fbaStockRefreshPayloadSchema.parse({
      observedAt: "2026-09-22T03:00:00.000Z",
      snapshots: [{ marketplace: "US", source_row_count: 1, candidates: [validFbaCandidate] }],
    });
    expect(parsed.snapshots[0]?.candidates[0]?.fba_inbound_total).toBe(6);
  });

  it("rejects FBM, inactive, zero-stock, and extra payload fields", () => {
    expect(fbaStockRefreshPayloadSchema.safeParse({
      observedAt: "2026-09-22T03:00:00.000Z",
      snapshots: [{ marketplace: "US", source_row_count: 1, candidates: [{ ...validFbaCandidate, fulfillment_channel: "FBM" }] }],
    }).success).toBe(false);
    expect(fbaStockRefreshPayloadSchema.safeParse({
      observedAt: "2026-09-22T03:00:00.000Z",
      snapshots: [{ marketplace: "US", source_row_count: 1, candidates: [{ ...validFbaCandidate, fba_stock: 0, unexpected: true }] }],
    }).success).toBe(false);
  });
});

describe("SQP keyword ingest contract", () => {
  const baseTerm = {
    marketplace: "US",
    asin: "B0GWVDR845",
    search_query_score: 10,
    search_query_volume: 120,
    asin_impression_count: 1000,
    asin_click_count: 10,
    asin_cart_add_count: 0,
    asin_purchase_count: 0,
    asin_conversion_rate: 0,
    asin_purchase_share: 0,
    start_date: "2026-08-01",
    end_date: "2026-08-31",
  };

  it("accepts 6–20 tiered selected terms, including title fallback", () => {
    const terms = [
      { ...baseTerm, search_query: "pine cone incense", asin_purchase_count: 5, asin_conversion_rate: 25, selection_basis: "sqp_purchase" },
      { ...baseTerm, search_query: "natural pine incense", asin_purchase_count: 2, asin_conversion_rate: 15, selection_basis: "sqp_purchase" },
      { ...baseTerm, search_query: "pine incense sticks", asin_cart_add_count: 3, selection_basis: "sqp_cart" },
      { ...baseTerm, search_query: "incense sticks pine", asin_click_count: 2, selection_basis: "sqp_click" },
      { ...baseTerm, search_query: "long burning incense sticks", asin_click_count: 2, selection_basis: "sqp_click" },
      { ...baseTerm, search_query: "natural incense sticks", search_query_score: 0, search_query_volume: 0, asin_impression_count: 0, asin_click_count: 0, start_date: "", end_date: "", selection_basis: "title_fallback" },
    ];
    const parsed = sqpKeywordsRefreshPayloadSchema.parse({
      observedAt: "2026-09-22T03:00:00.000Z",
      source: { report_type: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", start_date: "2026-08-01", end_date: "2026-08-31" },
      listings: [{ marketplace: "US", asin: "B0GWVDR845", terms }],
    });
    expect(parsed.listings[0]?.terms).toHaveLength(6);
    expect(parsed.listings[0]?.terms[5]?.selection_basis).toBe("title_fallback");
  });

  it("rejects fewer than six terms and unknown selection basis", () => {
    const result = sqpKeywordsRefreshPayloadSchema.safeParse({
      observedAt: "2026-09-22T03:00:00.000Z",
      source: { report_type: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT", start_date: "2026-08-01", end_date: "2026-08-31" },
      listings: [{ marketplace: "US", asin: "B0GWVDR845", terms: [{ ...baseTerm, search_query: "incense", selection_basis: "unknown" }] }],
    });
    expect(result.success).toBe(false);
  });
});
