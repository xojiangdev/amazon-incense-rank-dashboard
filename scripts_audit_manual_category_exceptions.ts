import { and, eq } from "drizzle-orm";
import { listings } from "./drizzle/schema";
import { getDb } from "./server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      asin: listings.asin,
      marketplace: listings.marketplace,
      sku: listings.sku,
      category: listings.category,
      categoryName: listings.categoryName,
      fulfillmentChannel: listings.fulfillmentChannel,
      inventoryStatus: listings.inventoryStatus,
      fbaStock: listings.fbaStock,
      fbaInboundShipped: listings.fbaInboundShipped,
      createdAt: listings.createdAt,
      updatedAt: listings.updatedAt,
    })
    .from(listings)
    .where(and(eq(listings.marketplace, "US"), eq(listings.asin, "B0H3J6LR1K")));
  const eyeMask = await db
    .select({ asin: listings.asin, inventoryStatus: listings.inventoryStatus, fbaStock: listings.fbaStock })
    .from(listings)
    .where(and(eq(listings.marketplace, "US"), eq(listings.asin, "B0HJ1GPC2S")));

  const imported = rows[0] ?? null;
  console.log(JSON.stringify({ imported, eyeMaskRows: eyeMask.length }, null, 2));
  if (!imported || imported.category !== "other" || imported.fulfillmentChannel !== "FBA" || imported.inventoryStatus !== "Active" || (imported.fbaStock ?? 0) <= 0) {
    throw new Error("Manual exception import audit failed for B0H3J6LR1K");
  }
  if (eyeMask.length > 0) throw new Error("B0HJ1GPC2S must remain absent while FBA sellable stock is zero");
  console.log(JSON.stringify({ imported, eyeMaskCreated: false }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
