import fs from "node:fs/promises";
import path from "node:path";
import { calculateCprEstimate, type CprOrganicResult } from "../shared/cpr";

type Target = { marketplace: "US" | "CA" | "JP"; keyword: string; asins: string[] };

interface SerpItem {
  type?: string;
  data_asin?: string;
  rank_absolute?: number;
  rank_group?: number;
  bought_past_month?: number | null;
  url?: string;
}

export interface ProcessedSerpResult {
  marketplace: "US" | "CA" | "JP";
  keyword: string;
  cprEstimate: number | null;
  cprMonthlySalesAverage: number | null;
  cprSampleCount: number;
  asinPositions: Record<string, { pcAdRank: number; pcSbvRank: number }>;
}

export function processDesktopSerp(
  target: Target,
  items: SerpItem[]
): ProcessedSerpResult {
  // 1. CPR estimation: Extract natural products (type === "amazon_serp") and their monthly sales
  const naturalProducts: CprOrganicResult[] = [];
  for (const item of items) {
    if (item.type === "amazon_serp" && typeof item.rank_group === "number") {
      naturalProducts.push({
        rank: item.rank_group,
        monthlySalesVolume: typeof item.bought_past_month === "number" ? item.bought_past_month : null,
      });
    }
  }
  const cpr = calculateCprEstimate(naturalProducts, { rangeStart: 21, rangeEnd: 30, minSamples: 5 });

  // 2. PC Ad and PC SBV positions: Search for exact target ASINs in amazon_paid items
  const asinPositions: Record<string, { pcAdRank: number; pcSbvRank: number }> = {};
  for (const asin of target.asins) {
    let minAdRank = 999;
    let minSbvRank = 999;

    for (const item of items) {
      if (item.type === "amazon_paid" && item.data_asin === asin && typeof item.rank_absolute === "number") {
        minAdRank = Math.min(minAdRank, item.rank_absolute);
        const url = (item.url ?? "").toLowerCase();
        if (url.includes("sbv_search") || url.includes("sponsored-brands-video") || url.includes("sbv")) {
          minSbvRank = Math.min(minSbvRank, item.rank_absolute);
        }
      }
    }
    asinPositions[asin] = { pcAdRank: minAdRank, pcSbvRank: minSbvRank };
  }

  return {
    marketplace: target.marketplace,
    keyword: target.keyword,
    cprEstimate: cpr.cprEstimate,
    cprMonthlySalesAverage: cpr.monthlySalesAverage,
    cprSampleCount: cpr.sampleCount,
    asinPositions,
  };
}
