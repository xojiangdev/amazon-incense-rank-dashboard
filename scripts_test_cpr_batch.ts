import fs from "node:fs/promises";
import path from "node:path";
import { applyCprEstimates, type CprEstimateInput } from "./server/db";
import { calculateCprEstimate } from "./shared/cpr";

const root = path.resolve("private_spapi_import");
const targetsPath = path.join(root, "rank_targets.json");
const targetsRaw = await fs.readFile(targetsPath, "utf8");
const targets = JSON.parse(targetsRaw) as Array<{ marketplace: "US" | "CA" | "JP"; asin: string; keywords: string[] }>;

// Collect unique marketplace + keyword pairs to avoid redundant external calls
const uniqueKeywords = new Map<string, { marketplace: "US" | "CA" | "JP"; keyword: string }>();
for (const target of targets) {
  for (const keyword of target.keywords) {
    const key = `${target.marketplace}:${keyword.trim().normalize("NFKC").toLowerCase()}`;
    if (!uniqueKeywords.has(key)) uniqueKeywords.set(key, { marketplace: target.marketplace, keyword });
  }
}

console.log(JSON.stringify({
  totalTargets: targets.length,
  totalTargetKeywords: targets.reduce((sum, item) => sum + item.keywords.length, 0),
  uniqueKeywords: uniqueKeywords.size,
}, null, 2));
