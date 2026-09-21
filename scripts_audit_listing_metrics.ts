import fs from "node:fs/promises";
import path from "node:path";
import { getListings } from "./server/db";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const rows = await getListings();
const inboundMismatch = rows.filter(item => item.fbaInboundTotal !== item.fbaInboundWorking + item.fbaInboundShipped + item.fbaInboundReceiving);
const synchronized = rows.filter(item => item.reviewUpdatedAt !== null);
const withRating = rows.filter(item => item.reviewRating !== null && (item.reviewCount ?? 0) > 0);
const audit = {
  auditedAt: new Date().toISOString(),
  listingCount: rows.length,
  byMarketplace: Object.fromEntries(["US", "CA", "JP"].map(market => [market, rows.filter(item => item.marketplace === market).length])),
  inventory: {
    fulfillableTotal: rows.reduce((sum, item) => sum + (item.fbaStock ?? 0), 0),
    inboundWorkingTotal: rows.reduce((sum, item) => sum + item.fbaInboundWorking, 0),
    inboundShippedTotal: rows.reduce((sum, item) => sum + item.fbaInboundShipped, 0),
    inboundReceivingTotal: rows.reduce((sum, item) => sum + item.fbaInboundReceiving, 0),
    inboundTotal: rows.reduce((sum, item) => sum + item.fbaInboundTotal, 0),
    listingsWithInbound: rows.filter(item => item.fbaInboundTotal > 0).length,
    inboundMismatchCount: inboundMismatch.length,
  },
  reviews: {
    synchronized: synchronized.length,
    withRating: withRating.length,
    noRating: rows.length - withRating.length,
    reviewCountTotal: withRating.reduce((sum, item) => sum + (item.reviewCount ?? 0), 0),
    averageRating: withRating.length ? Number((withRating.reduce((sum, item) => sum + Number(item.reviewRating), 0) / withRating.length).toFixed(2)) : null,
  },
  salesCategories: Object.fromEntries(["unclassified", "new_product", "key_product", "long_tail", "regular", "discontinued", "custom"].map(category => [category, rows.filter(item => item.salesCategory === category).length])),
};
if (inboundMismatch.length) throw new Error(`Inbound total mismatch on ${inboundMismatch.length} Listing(s)`);
const output = path.join(root, "private_spapi_import", "listing_metrics_audit.json");
await fs.writeFile(output, JSON.stringify(audit, null, 2), "utf8");
console.log(JSON.stringify({ output, ...audit }, null, 2));
