import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { dailyRankSnapshots, keywords, listings } from "./drizzle/schema";
import { getDb } from "./server/db";

const root = path.resolve("private_spapi_import");
const importAudit = JSON.parse(await fs.readFile(path.join(root, "four_metrics_final_partial_import_audit.json"), "utf8"));
const scope = JSON.parse(await fs.readFile(path.join(root, "rank_targets_final_excluding_4_temporary_listings.json"), "utf8"));
const db = await getDb();
if (!db) throw new Error("Database unavailable");
const normalize = (keyword: string) => keyword.trim().normalize("NFKC").toLowerCase();
const targetKey = (marketplace: string, asin: string, keyword: string) => `${marketplace}:${asin.trim().toUpperCase()}:${normalize(keyword)}`;
const scopeListings = await db.select().from(listings).where(inArray(listings.asin, scope.targets.map((target: any) => target.asin)));
const wantedListingKeys = new Set(scope.targets.map((target: any) => `${target.marketplace}:${target.asin}`));
const relevantListings = scopeListings.filter(item => wantedListingKeys.has(`${item.marketplace}:${item.asin}`));
if (relevantListings.length !== scope.expectedListings) throw new Error(`Listing audit mismatch: expected ${scope.expectedListings}, found ${relevantListings.length}`);
const listingIds = relevantListings.map(item => item.id);
const scopedKeywords = await db.select().from(keywords).where(and(inArray(keywords.listingId, listingIds), eq(keywords.isCore, true)));
const listingById = new Map(relevantListings.map(item => [item.id, item] as const));
const expected = new Set(scope.targets.flatMap((target: any) => target.keywords.map((keyword: string) => targetKey(target.marketplace, target.asin, keyword))));
const scoped = scopedKeywords.filter(keyword => {
  const listing = listingById.get(keyword.listingId);
  return listing && expected.has(targetKey(listing.marketplace, listing.asin, keyword.keyword));
});
const scopedKeys = new Set(scoped.map(keyword => {
  const listing = listingById.get(keyword.listingId)!;
  return targetKey(listing.marketplace, listing.asin, keyword.keyword);
}));
const missing = [...expected].filter(key => !scopedKeys.has(key));
const snapshotDate = importAudit.snapshotDate;
const snapshots = await db.select().from(dailyRankSnapshots).where(and(eq(dailyRankSnapshots.snapshotDate, snapshotDate), inArray(dailyRankSnapshots.keywordId, scoped.map(keyword => keyword.id))));
const snapshotIds = new Set(snapshots.map(row => row.keywordId));
const noSnapshot = scoped.filter(keyword => !snapshotIds.has(keyword.id));
const byMarket = Object.fromEntries(["US", "CA", "JP"].map(marketplace => [marketplace, {
  listings: relevantListings.filter(item => item.marketplace === marketplace).length,
  keywords: scoped.filter(keyword => listingById.get(keyword.listingId)?.marketplace === marketplace).length,
  snapshots: snapshots.filter(snapshot => snapshot.marketplace === marketplace).length,
}]));
const report = {
  status: "final_partial_database_audit",
  snapshotDate,
  scope: { listings: scope.expectedListings, keywords: scope.expectedRows, excludedListings: scope.excluded, excludedKeywordCount: scope.excludedKeywordCount },
  db: {
    scopedListings: relevantListings.length,
    scopedKeywords: scoped.length,
    expectedKeys: expected.size,
    missingKeys: missing.length,
    snapshots: snapshots.length,
    missingSnapshots: noSnapshot.length,
    byMarket,
    natural: { top10: scoped.filter(keyword => (keyword.currentRank ?? 0) > 0 && (keyword.currentRank ?? 0) <= 10).length, top50: scoped.filter(keyword => (keyword.currentRank ?? 0) > 0 && (keyword.currentRank ?? 0) <= 50).length, outsideTopThreePages: scoped.filter(keyword => keyword.currentRank === 999).length },
    cpr: { calculated: scoped.filter(keyword => keyword.cprEstimate !== null).length, insufficientEvidence: scoped.filter(keyword => keyword.cprEstimate === null).length },
    advertising: { pcAdFound: scoped.filter(keyword => (keyword.pcAdRank ?? 999) < 999).length, pcSbvFound: scoped.filter(keyword => (keyword.pcSbvRank ?? 999) < 999).length, neitherFound: scoped.filter(keyword => (keyword.pcAdRank ?? 999) === 999 && (keyword.pcSbvRank ?? 999) === 999).length },
  },
  importResult: importAudit.import,
};
if (report.db.scopedKeywords !== scope.expectedRows || report.db.expectedKeys !== scope.expectedRows || report.db.missingKeys !== 0 || report.db.snapshots !== scope.expectedRows || report.db.missingSnapshots !== 0) throw new Error(`Final database audit mismatch: ${JSON.stringify(report.db)}`);
await fs.writeFile(path.join(root, "four_metrics_final_database_audit.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
