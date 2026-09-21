import fs from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { dailyRankSnapshots, keywords, listings } from "./drizzle/schema";
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

type SelectionBasis = "sqp_purchase" | "sqp_cart" | "sqp_click" | "title_fallback";
type SelectedRow = SqpRow & { selectionBasis: SelectionBasis; valueScore: number };

const TERM_COUNT_MIN = 6;
const TERM_COUNT_MAX = 20;
const MIN_CLICK_ONLY_SEARCH_VOLUME = 20;

function normalize(value: string) {
  return value.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
}

function evidenceTier(row: SqpRow): Exclude<SelectionBasis, "title_fallback"> {
  if (row.asin_purchase_count > 0) return "sqp_purchase";
  if (row.asin_cart_add_count > 0) return "sqp_cart";
  return "sqp_click";
}

function valueScore(row: SqpRow): number {
  // Do not trade down a stronger funnel event for raw query volume.
  return (
    row.asin_purchase_count * 1_000_000_000 +
    row.asin_cart_add_count * 1_000_000 +
    row.asin_click_count * 10_000 +
    row.asin_impression_count * 10 +
    Math.log10(Math.max(0, row.search_query_volume) + 1) * 100 +
    row.asin_purchase_share * 1_000
  );
}

function productTermsFromTitle(title: string): string[] {
  const lower = title.toLowerCase();
  return [
    "ambergris", "pine cone", "goose pear", "sandalwood", "lavender", "cherry blossom", "plum blossom", "osmanthus", "magnolia",
    "bamboo forest", "hinoki", "cliff cypress", "agarwood", "lakawood", "mugwort", "white sage", "palo santo", "wisteria", "yuzu",
    "imperial palace", "oud", "charcoal free", "coreless", "backflow", "ash catcher", "upside down", "hanging", "wooden", "brass", "ceramic",
  ].filter(term => lower.includes(term));
}

function isProductRelevant(query: string, title: string, category: string, hasPurchase: boolean): boolean {
  // A demonstrated purchase is retained as observed commercial evidence. Every lower-funnel
  // term must also match the product's category and a concrete title attribute.
  if (hasPurchase) return true;
  const normalizedQuery = normalize(query);
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes("chinese") && normalizedQuery.includes("japanese")) return false;
  if (category === "incense_sticks") {
    if (!normalizedQuery.includes("incense")) return false;
    const productTerms = productTermsFromTitle(title);
    return normalizedQuery.includes("incense sticks") || productTerms.some(term => normalizedQuery.includes(term));
  }
  if (category === "incense_holder" || category === "incense_burner") {
    return /(holder|burner|censer|ash catcher|incense stand)/.test(normalizedQuery);
  }
  return false;
}

function qualifiesAsHighIntentFunnelTerm(row: SqpRow): boolean {
  if (row.asin_purchase_count > 0 || row.asin_cart_add_count > 0) return true;
  return row.asin_click_count >= 2 || (row.asin_click_count >= 1 && row.search_query_volume >= MIN_CLICK_ONLY_SEARCH_VOLUME);
}

function titleFallbackTerms(title: string, category: string): string[] {
  const lower = title.toLowerCase();
  const scentPool = [
    "ambergris", "pine cone", "goose pear", "sandalwood", "lavender", "cherry blossom",
    "plum blossom", "osmanthus", "magnolia", "bamboo forest", "hinoki", "cliff cypress",
    "agarwood", "lakawood", "mugwort", "white sage", "palo santo", "wisteria", "yuzu", "imperial palace",
  ];
  const scent = scentPool.find(item => lower.includes(item)) ?? "natural";
  if (category === "incense_holder" || category === "incense_burner") {
    const material = lower.includes("wooden") ? "wooden" : lower.includes("brass") ? "brass" : lower.includes("ceramic") || lower.includes("porcelain") ? "ceramic" : "decorative";
    const feature = lower.includes("hanging") || lower.includes("upside down") ? "hanging" : lower.includes("ash catcher") ? "ash catcher" : "meditation";
    return ["incense holder", "incense holder for sticks", "incense stick holder", `${material} incense holder`, `${feature} incense holder`, "incense holder with ash catcher", "incense burner for sticks", "incense burner"];
  }
  const form = lower.includes("coreless") ? "coreless" : lower.includes("charcoal-free") || lower.includes("charcoal free") ? "charcoal free" : "natural";
  return [`${scent} incense sticks`, `${scent} incense`, `natural ${scent} incense sticks`, `${form} ${scent} incense sticks`, `${scent} incense sticks for meditation`, `long burning ${scent} incense`, `${scent} aromatherapy incense`, `${scent} joss sticks`];
}

function selectCoreTerms(rows: SqpRow[], title: string, category: string): SelectedRow[] {
  const byQuery = new Map<string, SqpRow>();
  for (const row of rows) {
    const key = normalize(row.search_query);
    if (!key || key === "*") continue;
    const existing = byQuery.get(key);
    if (!existing || valueScore(row) > valueScore(existing)) byQuery.set(key, row);
  }

  // Tier A: purchases; Tier B: add-to-cart; Tier C: high-intent clicks. Low-volume
  // single-click impressions never enter the core pool and may not be sold as high-value terms.
  const evidenceRows = [...byQuery.values()]
    .filter(row => qualifiesAsHighIntentFunnelTerm(row))
    .filter(row => isProductRelevant(row.search_query, title, category, row.asin_purchase_count > 0))
    .map(row => ({ ...row, selectionBasis: evidenceTier(row), valueScore: valueScore(row) }))
    .sort((a, b) => b.valueScore - a.valueScore);

  const selected = evidenceRows.slice(0, TERM_COUNT_MAX);
  const occupied = new Set(selected.map(row => normalize(row.search_query)));
  const additional = titleFallbackTerms(title, category)
    .map(normalize)
    .filter((term, index, all) => term && !occupied.has(term) && all.indexOf(term) === index)
    .slice(0, Math.max(0, TERM_COUNT_MIN - selected.length));

  for (const term of additional) {
    selected.push({
      marketplace: rows[0]?.marketplace ?? "US",
      asin: rows[0]?.asin ?? "",
      search_query: term,
      search_query_score: 0,
      search_query_volume: 0,
      asin_impression_count: 0,
      asin_click_count: 0,
      asin_cart_add_count: 0,
      asin_purchase_count: 0,
      asin_conversion_rate: 0,
      asin_purchase_share: 0,
      start_date: "",
      end_date: "",
      selectionBasis: "title_fallback",
      valueScore: 0,
    });
  }
  return selected.slice(0, TERM_COUNT_MAX);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const sourceRows = JSON.parse(await fs.readFile(path.join(root, "private_spapi_import", "us_ca_sqp_normalized.json"), "utf8")) as SqpRow[];
  if (!Array.isArray(sourceRows) || !sourceRows.length) throw new Error("Official SQP source contains no query rows; keyword import aborted");

  const liveListings = await getListings();
  const audit = {
    source: "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    sourcePeriod: "2026-08-01 to 2026-08-31",
    sourceRows: sourceRows.length,
    selectionPolicy: "purchase > cart > click; no-click SQP impressions are excluded; title fallback is explicitly labeled and only fills the 6-keyword minimum",
    listingCount: liveListings.length,
    totalImportedTerms: 0,
    byBasis: { sqp_purchase: 0, sqp_cart: 0, sqp_click: 0, title_fallback: 0 },
    listingResults: [] as Array<Record<string, unknown>>,
  };

  await db.transaction(async tx => {
    const oldKeywordRows = await tx.select({ id: keywords.id }).from(keywords);
    const oldIds = oldKeywordRows.map(row => row.id);
    if (oldIds.length) await tx.delete(dailyRankSnapshots).where(inArray(dailyRankSnapshots.keywordId, oldIds));
    await tx.delete(keywords);

    for (const listing of liveListings) {
      const rows = sourceRows.filter(row => row.marketplace === listing.marketplace && row.asin === listing.asin);
      const selected = selectCoreTerms(rows, listing.title, listing.category);
      if (selected.length < TERM_COUNT_MIN || selected.length > TERM_COUNT_MAX) throw new Error(`Keyword selection count invalid for ${listing.marketplace}/${listing.asin}: ${selected.length}`);

      const basisCount = { sqp_purchase: 0, sqp_cart: 0, sqp_click: 0, title_fallback: 0 };
      for (const row of selected) {
        basisCount[row.selectionBasis] += 1;
        audit.byBasis[row.selectionBasis] += 1;
        await tx.insert(keywords).values({
          listingId: listing.id,
          keyword: normalize(row.search_query),
          searchVolume: row.search_query_volume,
          historicalConversionCount: row.asin_purchase_count,
          conversionRate: row.asin_conversion_rate.toFixed(2),
          relevanceScore: row.selectionBasis === "title_fallback" ? 65 : Math.max(1, 101 - Math.min(100, row.search_query_score || 100)),
          isCore: true,
          source: row.selectionBasis === "title_fallback" ? "organic_high_value" : "sqp_converting",
          selectionBasis: row.selectionBasis,
          currentRank: 0,
          previousRank: 0,
          rankChange: 0,
          bestRank: 0,
          pageNumber: 0,
        });
      }
      audit.totalImportedTerms += selected.length;
      audit.listingResults.push({
        marketplace: listing.marketplace,
        asin: listing.asin,
        sku: listing.sku,
        sqpRows: rows.length,
        importedTerms: selected.length,
        byBasis: basisCount,
        terms: selected.map(row => ({
          query: normalize(row.search_query),
          selectionBasis: row.selectionBasis,
          purchases: row.asin_purchase_count,
          carts: row.asin_cart_add_count,
          clicks: row.asin_click_count,
          impressions: row.asin_impression_count,
          volume: row.search_query_volume,
          conversionRate: row.asin_conversion_rate,
        })),
      });
    }
  });

  for (const listing of liveListings) {
    const record = audit.listingResults.find(item => item.asin === listing.asin && item.marketplace === listing.marketplace)!;
    await addSalesLog(listing.id, "Amazon SQP 证据分层", `核心词池已按购买、加购、点击证据分层重建：购买 ${Number((record.byBasis as Record<string, number>).sqp_purchase)}、加购 ${Number((record.byBasis as Record<string, number>).sqp_cart)}、点击 ${Number((record.byBasis as Record<string, number>).sqp_click)}、标题补足 ${Number((record.byBasis as Record<string, number>).title_fallback)}。`, "核心词审计", "仅“SQP购买”可称为真实出单词；其余词按证据类型明确展示，待后续SQP数据替换。");
  }

  const auditPath = path.join(root, "private_spapi_import", "us_ca_sqp_keyword_import_audit.json");
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ totalImportedTerms: audit.totalImportedTerms, byBasis: audit.byBasis, auditPath }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
