import { eq } from "drizzle-orm";
import { dailyRankSnapshots, keywords, listings } from "./drizzle/schema";
import { getDb } from "./server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const snapshots = await db.select().from(dailyRankSnapshots).where(eq(dailyRankSnapshots.snapshotDate, today));
  const keywordRows = await db.select().from(keywords);
  const listingRows = await db.select().from(listings);
  const activeListingIds = new Set(listingRows.filter(row => row.fulfillmentChannel === "FBA" && row.inventoryStatus === "Active" && (row.fbaStock ?? 0) > 0).map(row => row.id));
  const targetKeywords = keywordRows.filter(row => activeListingIds.has(row.listingId) && row.isCore);
  const ranks = snapshots.map(row => row.rank);
  console.log(JSON.stringify({
    snapshotDate: today,
    expectedKeywords: targetKeywords.length,
    snapshots: snapshots.length,
    complete: snapshots.length === targetKeywords.length,
    top10: ranks.filter(rank => rank <= 10).length,
    top50: ranks.filter(rank => rank <= 50).length,
    outsideFirst3Pages: ranks.filter(rank => rank === 999).length,
  }, null, 2));
  process.exit(snapshots.length === targetKeywords.length ? 0 : 2);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
