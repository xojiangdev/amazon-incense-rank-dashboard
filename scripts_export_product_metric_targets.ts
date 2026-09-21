import fs from "node:fs/promises";
import path from "node:path";
import { getListings } from "./server/db";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const rows = await getListings();
const targets = rows.map(item => ({ marketplace: item.marketplace, asin: item.asin }));
const output = path.join(root, "private_spapi_import", "product_metric_targets.json");
await fs.writeFile(output, JSON.stringify(targets, null, 2), "utf8");
console.log(JSON.stringify({ output, count: targets.length, byMarketplace: Object.fromEntries(["US", "CA", "JP"].map(market => [market, targets.filter(item => item.marketplace === market).length])) }, null, 2));
