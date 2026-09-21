import { eq } from "drizzle-orm";
import { keywords, listings } from "./drizzle/schema";
import { getDb, getListings } from "./server/db";

const db = await getDb();
if (!db) throw new Error("Database unavailable");
const liveListings = await getListings();
const hasSavedManualOrder = liveListings.some(item => item.manualSortOrder > 0);
const summary = { key_product: 0, long_tail: 0, regular: 0, preserved: 0, orderInitialized: !hasSavedManualOrder };

for (let index = 0; index < liveListings.length; index += 1) {
  const listing = liveListings[index]!;
  const ownKeywords = await db.select().from(keywords).where(eq(keywords.listingId, listing.id));
  const totalConversions = ownKeywords.reduce((sum, keyword) => sum + (keyword.historicalConversionCount ?? 0), 0);
  const top10Count = ownKeywords.filter(keyword => (keyword.currentRank ?? 0) > 0 && (keyword.currentRank ?? 0) <= 10).length;
  const top50Count = ownKeywords.filter(keyword => (keyword.currentRank ?? 0) > 0 && (keyword.currentRank ?? 0) <= 50).length;

  let salesCategory = listing.salesCategory;
  if (salesCategory === "unclassified") {
    salesCategory = totalConversions >= 10 || top10Count > 0 ? "key_product" : totalConversions <= 1 && top50Count === 0 ? "long_tail" : "regular";
    summary[salesCategory] += 1;
  } else {
    summary.preserved += 1;
  }

  await db
    .update(listings)
    .set({
      salesCategory,
      ...(hasSavedManualOrder ? {} : { manualSortOrder: (index + 1) * 10 }),
    })
    .where(eq(listings.id, listing.id));
}

console.log(JSON.stringify({ liveListings: liveListings.length, ...summary }, null, 2));
process.exit(0);
