import { sql } from "drizzle-orm";
import { getDb } from "./server/db";
import { keywords } from "./drizzle/schema";

const db = await getDb();
if (!db) throw new Error("Database unavailable");
const counts = await db
  .select({
    selectionBasis: keywords.selectionBasis,
    count: sql<number>`count(*)`,
    withPurchases: sql<number>`sum(case when ${keywords.historicalConversionCount} > 0 then 1 else 0 end)`,
  })
  .from(keywords)
  .groupBy(keywords.selectionBasis);

console.log(JSON.stringify(counts, null, 2));
