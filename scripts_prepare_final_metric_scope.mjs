import fs from "node:fs";
import path from "node:path";
const root = path.resolve("private_spapi_import");
const fullTargets = JSON.parse(fs.readFileSync(path.join(root, "rank_targets.json"), "utf8"));
const excluded = [
  { marketplace: "CA", asin: "B0FY6JR3NK", reason: "User-directed temporary skip after collection task timed out" },
  { marketplace: "US", asin: "B0FY67YPSM", reason: "User-directed temporary skip to publish all other fully verified Listings immediately" },
  { marketplace: "US", asin: "B0FY67W88Z", reason: "User-directed temporary skip after two-keyword repair failed closed on a control-character scope violation" },
  { marketplace: "US", asin: "B0FY1RZGZH", reason: "Temporary skip after five rows failed CPR sample-count validation; must be recollected" },
];
const excludedKeys = new Set(excluded.map(item => `${item.marketplace}:${item.asin}`));
const targets = fullTargets.filter(target => !excludedKeys.has(`${target.marketplace}:${target.asin}`));
const excludedTargets = fullTargets.filter(target => excludedKeys.has(`${target.marketplace}:${target.asin}`));
const expectedRows = targets.reduce((sum, target) => sum + target.keywords.length, 0);
const excludedKeywordCount = excludedTargets.reduce((sum, target) => sum + target.keywords.length, 0);
if (fullTargets.length !== 42 || targets.length !== 38 || expectedRows !== 294 || excludedTargets.length !== 4 || excludedKeywordCount !== 76) throw new Error(`Unexpected final scope: full=${fullTargets.length}, targets=${targets.length}, rows=${expectedRows}, excluded=${excludedTargets.length}/${excludedKeywordCount}`);
const scope = { status: "final_partial_recovery_scope", createdAt: new Date().toISOString(), canonicalTargetFile: "rank_targets.json", expectedListings: targets.length, expectedRows, excluded, excludedKeywordCount, targets };
const output = path.join(root, "rank_targets_final_excluding_4_temporary_listings.json");
fs.writeFileSync(output, `${JSON.stringify(scope, null, 2)}\n`);
console.log(JSON.stringify({ output, expectedListings: targets.length, expectedRows, excluded }, null, 2));
