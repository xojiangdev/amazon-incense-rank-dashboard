import { and, eq } from "drizzle-orm";
import { keywords, listings } from "./drizzle/schema";
import { getDb } from "./server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const targetListings = await db.select().from(listings).where(eq(listings.asin, "B0FY5K8HMT"));
  if (targetListings.length !== 1) throw new Error(`Expected one Imperial Palace listing, found ${targetListings.length}`);
  const listing = targetListings[0];
  const replacements: Record<string, string> = {
    "natural incense sticks": "imperial palace incense sticks",
    "natural incense": "imperial palace incense",
    "natural natural incense sticks": "natural imperial palace incense sticks",
    "natural incense sticks for meditation": "imperial palace incense sticks for meditation",
    "long burning natural incense": "traditional chinese incense sticks",
  };
  let updated = 0;
  for (const [from, to] of Object.entries(replacements)) {
    const result = await db.update(keywords).set({ keyword: to, updatedAt: new Date() }).where(and(eq(keywords.listingId, listing.id), eq(keywords.keyword, from)));
    updated += Number((result as any)[0]?.affectedRows ?? 0);
  }
  console.log(JSON.stringify({ asin: listing.asin, updated }));
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
