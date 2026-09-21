import { eq, inArray } from "drizzle-orm";
import { dailyRankSnapshots, keywords, listings } from "./drizzle/schema";
import { getDb, getDashboardOverview, getListings } from "./server/db";

const db = await getDb();
if (!db) throw new Error("Database unavailable");
const live = await getListings();
const overview = await getDashboardOverview();
const listingIds = live.map(item => item.id);
const keywordRows = listingIds.length ? await db.select().from(keywords).where(inArray(keywords.listingId, listingIds)) : [];
const snapshots = await db.select().from(dailyRankSnapshots).where(eq(dailyRankSnapshots.snapshotDate, "2026-09-21"));
const audit = {
  liveListings: live.length,
  byMarketplace: Object.fromEntries(["US", "CA", "JP"].map(market => [market, live.filter(item => item.marketplace === market).length])),
  keywords: keywordRows.length,
  keywordRange: {
    min: Math.min(...live.map(item => keywordRows.filter(keyword => keyword.listingId === item.id).length)),
    max: Math.max(...live.map(item => keywordRows.filter(keyword => keyword.listingId === item.id).length)),
  },
  snapshots: snapshots.length,
  top10: snapshots.filter(row => row.rank <= 10).length,
  top50: snapshots.filter(row => row.rank <= 50).length,
  outsideFirst3Pages: snapshots.filter(row => row.rank === 999).length,
  previousRanksCleared: keywordRows.every(row => (row.previousRank ?? 0) === 0),
  importanceSorted: live.every((item, index) => index === 0 || (live[index - 1].importanceScore ?? 0) >= (item.importanceScore ?? 0)),
  overview,
};
console.log(JSON.stringify(audit, null, 2));
process.exit(audit.snapshots === audit.keywords && audit.previousRanksCleared && audit.importanceSorted ? 0 : 2);
