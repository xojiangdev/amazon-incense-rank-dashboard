import { eq } from "drizzle-orm";
import { keywords } from "./drizzle/schema";
import { addSalesLog, getDb, getListingKeywords, getListings } from "./server/db";

function distinctivePhrase(title: string): string {
  const lower = title.toLowerCase();
  const scents = [
    "ambergris", "pine cone", "goose pear", "sandalwood", "lavender", "cherry blossom",
    "plum blossom", "osmanthus", "magnolia", "bamboo forest", "hinoki", "cliff cypress",
    "agarwood", "lakawood", "mugwort", "white sage", "palo santo", "wisteria", "yuzu",
    "imperial palace",
  ];
  return scents.find(scent => lower.includes(scent)) || "natural";
}

function candidateTerms(title: string, category: string): string[] {
  const lower = title.toLowerCase();
  if (category === "incense_holder" || category === "incense_burner") {
    const material = lower.includes("wooden") ? "wooden" : lower.includes("brass") ? "brass" : lower.includes("porcelain") ? "porcelain" : "decorative";
    const feature = lower.includes("hanging") || lower.includes("upside down") ? "hanging" : lower.includes("ash catcher") ? "ash catcher" : "meditation";
    return [
      "incense holder",
      "incense holder for sticks",
      "incense stick holder",
      `${material} incense holder`,
      `${feature} incense holder`,
      "incense holder with ash catcher",
      "modern incense holder",
      "incense burner for sticks",
    ];
  }

  const scent = distinctivePhrase(title);
  const form = lower.includes("coreless") ? "coreless" : lower.includes("charcoal-free") || lower.includes("charcoal free") ? "charcoal free" : "natural";
  return [
    `${scent} incense sticks`,
    `${scent} incense`,
    `natural ${scent} incense sticks`,
    `${form} ${scent} incense sticks`,
    `${scent} incense sticks for meditation`,
    `long burning ${scent} incense`,
    `${scent} aromatherapy incense`,
    `${scent} joss sticks`,
  ];
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const listings = await getListings();
  const result: Array<Record<string, unknown>> = [];

  for (const listing of listings) {
    const existing = await getListingKeywords(listing.id);
    const existingSet = new Set(existing.map(row => row.keyword.trim().toLowerCase()));
    const needed = Math.max(0, 6 - existing.length);
    if (!needed) continue;

    const selected = candidateTerms(listing.title, listing.category)
      .map(term => term.trim().toLowerCase())
      .filter((term, index, all) => term && !existingSet.has(term) && all.indexOf(term) === index)
      .slice(0, needed);

    if (selected.length < needed) {
      throw new Error(`Unable to create six distinct high-intent terms for ${listing.marketplace}/${listing.asin}`);
    }

    for (const term of selected) {
      await db.insert(keywords).values({
        listingId: listing.id,
        keyword: term,
        searchVolume: 0,
        historicalConversionCount: 0,
        conversionRate: "0.00",
        relevanceScore: 80,
        isCore: true,
        source: "organic_high_value",
        currentRank: 0,
        previousRank: 0,
        rankChange: 0,
        bestRank: 0,
        pageNumber: 0,
      });
    }

    await addSalesLog(
      listing.id,
      "关键词完整性补充",
      `该 ASIN 的 2026-08 SQP 可用词不足 6 个，已补充 ${selected.length} 个标题强相关、高购买意图词。`,
      "关键词补充",
      "补充词标记为自然高价值词，不计作历史出单词；待后续 SQP 产生购买数据后自动由真实转化词替换。"
    );
    result.push({ marketplace: listing.marketplace, asin: listing.asin, previousCount: existing.length, added: selected.length, terms: selected });
  }

  const counts = [];
  for (const listing of listings) {
    const rows = await getListingKeywords(listing.id);
    counts.push({ marketplace: listing.marketplace, asin: listing.asin, count: rows.length });
  }
  const violations = counts.filter(item => item.count < 6 || item.count > 20);
  if (violations.length) throw new Error(`Keyword count audit failed: ${JSON.stringify(violations)}`);
  console.log(JSON.stringify({ supplementedListings: result.length, supplementedTerms: result.reduce((sum, item) => sum + Number(item.added), 0), totalListings: counts.length, countViolations: violations.length, result }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
