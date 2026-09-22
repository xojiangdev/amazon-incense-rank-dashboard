import { count } from "drizzle-orm";
import { getDb } from "./server/db";
import { dailyRankSnapshots, keywords } from "./drizzle/schema";

const db = await getDb();
if (!db) throw new Error("Database unavailable");
const snapshots = await db.select({ n: count() }).from(dailyRankSnapshots);
const trackedKeywords = await db.select({ n: count() }).from(keywords);
console.log(JSON.stringify({ snapshots: snapshots[0]?.n ?? 0, trackedKeywords: trackedKeywords[0]?.n ?? 0 }, null, 2));
