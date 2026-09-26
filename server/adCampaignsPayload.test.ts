import { describe, expect, it } from "vitest";
import { adCampaignsPayloadSchema } from "./scheduledRankHandler";

const metrics = {
  cost: 12.5,
  sales: 50,
  orders: 2,
  clicks: 9,
  impressions: 1200,
};

describe("ad campaign ingestion payload", () => {
  it("accepts an audited active campaign snapshot", () => {
    const parsed = adCampaignsPayloadSchema.parse({
      observedAt: "2026-09-26T10:00:00.000Z",
      marketplace: "US",
      campaigns: [{
        campaignId: "12345",
        name: "US Exact Defense",
        state: "ENABLED",
        budget: 20,
        targetingType: "MANUAL",
        asins: ["B0FY1T38P1"],
        adGroups: [{ name: "Exact", d7: metrics, d30: metrics }],
        summary: {
          endDate: "2026-09-25",
          yesterday: metrics,
          d7: metrics,
          d30: metrics,
          acosY: 0.25,
          acos7: 0.25,
          acos30: 0.25,
          acosPrev7: 0.3,
        },
      }],
    });

    expect(parsed.campaigns[0]?.asins).toEqual(["B0FY1T38P1"]);
    expect(parsed.campaigns[0]?.summary.d7.orders).toBe(2);
  });

  it("rejects malformed ASINs and negative metrics", () => {
    const result = adCampaignsPayloadSchema.safeParse({
      observedAt: "2026-09-26T10:00:00.000Z",
      marketplace: "US",
      campaigns: [{
        campaignId: "12345",
        name: "Invalid campaign",
        state: "ENABLED",
        asins: ["not-an-asin"],
        adGroups: [],
        summary: {
          endDate: "2026-09-25",
          yesterday: { ...metrics, cost: -1 },
          d7: metrics,
          d30: metrics,
          acosY: null,
          acos7: null,
          acos30: null,
          acosPrev7: null,
        },
      }],
    });

    expect(result.success).toBe(false);
  });
});
