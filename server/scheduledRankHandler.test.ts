import { describe, expect, it } from "vitest";
import { productMetricsPayloadSchema, rankPayloadSchema } from "./scheduledRankHandler";

describe("rankPayloadSchema", () => {
  it("accepts a valid real organic rank payload", () => {
    const parsed = rankPayloadSchema.parse({
      snapshotDate: "2026-09-21",
      snapshots: [
        { marketplace: "US", asin: "B0GWVDR845", keyword: "pine cone incense", rank: 7 },
        { marketplace: "CA", asin: "B0FY6HB74X", keyword: "sandalwood incense sticks", rank: 999, page: 4 },
        { marketplace: "JP", asin: "B0H7WQKSMR", keyword: "ヒノキ 線香", rank: 136, page: 3 },
      ],
    });
    expect(parsed.snapshots).toHaveLength(3);
    expect(parsed.snapshots[1]?.rank).toBe(999);
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
