import { describe, expect, it } from "vitest";
import { processDesktopSerp } from "./serpProcessor";

describe("processDesktopSerp", () => {
  it("calculates CPR and finds ad/SBV positions accurately", () => {
    const target = {
      marketplace: "US" as const,
      keyword: "incense burner",
      asins: ["B0TARGET1", "B0TARGET2"],
    };

    const mockItems = [
      // Natural products in ranks 21-30 with sales data
      { type: "amazon_serp", data_asin: "B0NAT21", rank_group: 21, bought_past_month: 300 },
      { type: "amazon_serp", data_asin: "B0NAT22", rank_group: 22, bought_past_month: 300 },
      { type: "amazon_serp", data_asin: "B0NAT23", rank_group: 23, bought_past_month: 300 },
      { type: "amazon_serp", data_asin: "B0NAT24", rank_group: 24, bought_past_month: 300 },
      { type: "amazon_serp", data_asin: "B0NAT25", rank_group: 25, bought_past_month: 300 },
      // Paid product matching B0TARGET1 (standard ad)
      { type: "amazon_paid", data_asin: "B0TARGET1", rank_absolute: 4, url: "https://amazon.com/dp/B0TARGET1/ref=sr_1_1" },
      // Paid product matching B0TARGET2 (SBV ad)
      { type: "amazon_paid", data_asin: "B0TARGET2", rank_absolute: 12, url: "https://amazon.com/dp/B0TARGET2/ref=sxin_sbv_search" },
    ];

    const result = processDesktopSerp(target, mockItems);

    expect(result.cprSampleCount).toBe(5);
    expect(result.cprMonthlySalesAverage).toBe(300);
    expect(result.cprEstimate).toBe(80); // (300 / 30) * 8 = 80
    expect(result.asinPositions["B0TARGET1"]).toEqual({ pcAdRank: 4, pcSbvRank: 999 });
    expect(result.asinPositions["B0TARGET2"]).toEqual({ pcAdRank: 12, pcSbvRank: 12 });
  });

  it("handles missing ads and insufficient CPR samples safely", () => {
    const target = {
      marketplace: "US" as const,
      keyword: "rare incense",
      asins: ["B0NOAD"],
    };

    const mockItems = [
      { type: "amazon_serp", data_asin: "B01", rank_group: 21, bought_past_month: 100 },
      { type: "amazon_serp", data_asin: "B02", rank_group: 22, bought_past_month: 100 },
    ];

    const result = processDesktopSerp(target, mockItems);

    expect(result.cprEstimate).toBeNull();
    expect(result.cprSampleCount).toBe(2);
    expect(result.asinPositions["B0NOAD"]).toEqual({ pcAdRank: 999, pcSbvRank: 999 });
  });
});
