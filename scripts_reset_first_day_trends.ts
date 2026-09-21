import { eq } from "drizzle-orm";
import { dailyRankSnapshots, keywords } from "./drizzle/schema";
import { getDb } from "./server/db";

const db = await getDb();
if (!db) throw new Error("Database unavailable");
await db.update(keywords).set({ previousRank: 0, rankChange: 0 });
await db.update(dailyRankSnapshots).set({ changeFromYesterday: 0 }).where(eq(dailyRankSnapshots.snapshotDate, "2026-09-21"));
console.log(JSON.stringify({ corrected: true, snapshotDate: "2026-09-21" }));
process.exit(0);
