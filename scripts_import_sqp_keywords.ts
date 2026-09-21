import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { keywords, listings } from "./drizzle/schema";
import { addSalesLog, getDb, getListings } from "./server/db";

type SqpRow = {
  marketplace: "US" | "CA";
  asin: string;
  search_query: string;
  search_query_score: number;
  search_query_volume: number;
  asin_impression_count: number;
  asin_click_count: number;
  asin_cart_add_count: number;
  asin_purchase_count: number;
  asin_conversion_rate: number;
  asin_purchase_share: number;
  start_date: string;
  end_date: string;
};

type SelectedRow = SqpRow & { tier: "converted" | "carted" | "clicked" | "impressed"; valueScore: number };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const inputPath = path.join(root, "private_spapi_import", "us_ca_sqp_normalized.json");

function rowTier(row: SqpRow): SelectedRow["tier"] {
  if (row.asin_purchase_count > 0) return "converted";
  if (row.asin_cart_add_count > 0) return "carted";
  if (row.asin_click_count > 0) return "clicked";
  return "impressed";
}

function valueScore(row: SqpRow): number {
  // Purchase proof dominates; cart and click evidence fill the minimum six only when needed.
  return (
    row.asin_purchase_count * 1_000_000_000 +
    row.asin_cart_add_count * 1_000_000 +
    row.asin_click_count * 10_000 +
    row.asin_impression_count * 10 +
    Math.log10(row.search_query_volume + 1) * 100 +
    row.asin_purchase_share * 1_000
  );
}

function selectCoreTerms(rows: SqpRow[]): SelectedRow[] {
  const deduplicated = new Map<string, SqpRow>();
  for (const row of rows) {
    const key = row.search_query.trim().toLowerCase();
    if (!key || key === "*") continue;
    const existing = deduplicated.get(key);
    if (!existing || valueScore(row) > valueScore(existing)) deduplicated.set(key, row);
  }

  const sorted = [...deduplicated.values()]
    .map(row => ({ ...row, tier: rowTier(row), valueScore: valueScore(row) } as SelectedRow))
    .sort((a, b) => b.valueScore - a.valueScore);

  const converting = sorted.filter(row => row.asin_purchase_count > 0);
  const targetCount = Math.min(20, Math.max(6, converting.length));
  return sorted.slice(0, Math.min(targetCount, sorted.length));
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = JSON.parse(await fs.readFile(inputPath, "utf8")) as SqpRow[];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Official SQP source contains no query rows; keyword import aborted");

  const liveListings = await getListings();
  const audit = {
    source: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    sourcePeriod: "2026-08-01 to 2026-08-31",
    sourceRows: rows.length,
    listingCount: liveListings.length,
    listingsWithSqpData: 0,
    listingsWithAtLeastSixTerms: 0,
    listingsWithPurchaseTerms: 0,
    totalImportedTerms: 0,
    listingResults: [] as Array<Record<string, unknown>>,
  };

  // Only clear after official source validation succeeds.
  await db.delete(keywords);

  for (const listing of liveListings) {
    const listingRows = rows.filter(row => row.marketplace === listing.marketplace && row.asin === listing.asin);
    const selected = selectCoreTerms(listingRows);
    const purchaseTermCount = selected.filter(row => row.asin_purchase_count > 0).length;
    if (listingRows.length > 0) audit.listingsWithSqpData += 1;
    if (selected.length >= 6) audit.listingsWithAtLeastSixTerms += 1;
    if (purchaseTermCount > 0) audit.listingsWithPurchaseTerms += 1;

    for (const row of selected) {
      await db.insert(keywords).values({
        listingId: listing.id,
        keyword: row.search_query,
        searchVolume: row.search_query_volume,
        historicalConversionCount: row.asin_purchase_count,
        conversionRate: row.asin_conversion_rate.toFixed(2),
        relevanceScore: Math.max(1, 101 - Math.min(100, row.search_query_score || 100)),
        isCore: true,
        source: "sqp_converting",
        currentRank: 0,
        previousRank: 0,
        rankChange: 0,
        bestRank: 0,
        pageNumber: 0,
      });
    }

    if (selected.length > 0) {
      await addSalesLog(
        listing.id,
        "Amazon SQP 官方数据",
        `按 2026-08 月度 Search Query Performance 数据建立 ${selected.length} 个核心词，其中有购买转化的搜索词 ${purchaseTermCount} 个。`,
        "核心词池更新",
        selected.length < 6
          ? "该 ASIN 本期可用搜索漏斗词不足 6 个；系统未使用虚构关键词，将等待下期 SQP 数据补齐。"
          : "核心词已按 ASIN购买量、加购、点击和查询量排序；有充足转化词时最多保留 20 个。"
      );
    }

    audit.totalImportedTerms += selected.length;
    audit.listingResults.push({
      marketplace: listing.marketplace,
      asin: listing.asin,
      sku: listing.sku,
      sqpRows: listingRows.length,
      importedTerms: selected.length,
      purchaseTerms: purchaseTermCount,
      topTerms: selected.slice(0, 5).map(row => ({ query: row.search_query, purchases: row.asin_purchase_count, carts: row.asin_cart_add_count, clicks: row.asin_click_count, volume: row.search_query_volume })),
    });
  }

  const dbKeywords = await db.select().from(keywords);
  if (dbKeywords.length !== audit.totalImportedTerms) {
    throw new Error(`Keyword import reconciliation failed: inserted=${audit.totalImportedTerms}, database=${dbKeywords.length}`);
  }

  const auditPath = path.join(root, "private_spapi_import", "us_ca_sqp_keyword_import_audit.json");
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  console.log(JSON.stringify({
    sourceRows: audit.sourceRows,
    listingCount: audit.listingCount,
    listingsWithSqpData: audit.listingsWithSqpData,
    listingsWithAtLeastSixTerms: audit.listingsWithAtLeastSixTerms,
    listingsWithPurchaseTerms: audit.listingsWithPurchaseTerms,
    totalImportedTerms: audit.totalImportedTerms,
    auditPath,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
