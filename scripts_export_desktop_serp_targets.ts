import fs from "node:fs/promises";
import path from "node:path";
import { getRankTrackingTargets } from "./server/db";

type Marketplace = "US" | "CA" | "JP";
type Target = { marketplace: Marketplace; keyword: string; asins: string[] };

const normalize = (value: string) => value.trim().normalize("NFKC").toLowerCase();
const targets = await getRankTrackingTargets();
const grouped = new Map<string, Target>();

for (const listing of targets) {
  for (const keyword of listing.keywords) {
    const normalized = normalize(keyword);
    const key = `${listing.marketplace}:${normalized}`;
    const group = grouped.get(key) ?? { marketplace: listing.marketplace, keyword: keyword.trim(), asins: [] };
    if (!group.asins.includes(listing.asin)) group.asins.push(listing.asin);
    grouped.set(key, group);
  }
}

const output = Array.from(grouped.values()).sort((a, b) =>
  a.marketplace.localeCompare(b.marketplace) || a.keyword.localeCompare(b.keyword)
);
const summary = {
  generatedAt: new Date().toISOString(),
  targetKeywordRows: targets.reduce((sum, item) => sum + item.keywords.length, 0),
  uniqueKeywordQueries: output.length,
  byMarketplace: output.reduce<Record<string, number>>((acc, item) => {
    acc[item.marketplace] = (acc[item.marketplace] ?? 0) + 1;
    return acc;
  }, {}),
  targets: output,
};

const outputPath = path.resolve("private_spapi_import/desktop_serp_targets.json");
await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...summary, targets: undefined }, null, 2));
