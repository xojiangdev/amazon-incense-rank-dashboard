import { eq } from "drizzle-orm";
import { getDb } from "./server/db";
import { keywords, listings } from "./drizzle/schema";

const asin = process.argv[2]?.trim().toUpperCase();
if (!asin) throw new Error("Usage: npx tsx scripts_audit_listing_keywords.ts <ASIN>");

const db = await getDb();
if (!db) throw new Error("Database unavailable");
const rows = await db
  .select({
    marketplace: listings.marketplace,
    asin: listings.asin,
    title: listings.title,
    category: listings.category,
    keyword: keywords.keyword,
    source: keywords.source,
    selectionBasis: keywords.selectionBasis,
    searchVolume: keywords.searchVolume,
    conversionCount: keywords.historicalConversionCount,
    conversionRate: keywords.conversionRate,
    relevanceScore: keywords.relevanceScore,
  })
  .from(keywords)
  .innerJoin(listings, eq(keywords.listingId, listings.id))
  .where(eq(listings.asin, asin));

console.log(JSON.stringify(rows, null, 2));
