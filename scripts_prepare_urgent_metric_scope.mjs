import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const fullTargets = JSON.parse(fs.readFileSync(path.join(root, "rank_targets.json"), "utf8"));
const excluded = [
  { marketplace: "CA", asin: "B0FY6JR3NK", reason: "User-directed temporary skip after collection task timed out" },
  { marketplace: "US", asin: "B0FY67YPSM", reason: "User-directed temporary skip to publish all other fully verified Listings immediately" },
];
const excludedKeys = new Set(excluded.map(item => `${item.marketplace}:${item.asin}`));
const targets = fullTargets.filter(target => !excludedKeys.has(`${target.marketplace}:${target.asin}`));
const excludedTargetRows = fullTargets.filter(target => excludedKeys.has(`${target.marketplace}:${target.asin}`));
const expectedRows = targets.reduce((sum, target) => sum + target.keywords.length, 0);
const excludedKeywordCount = excludedTargetRows.reduce((sum, target) => sum + target.keywords.length, 0);
if (fullTargets.length !== 42 || targets.length !== 40 || expectedRows !== 334 || excludedKeywordCount !== 36 || excludedTargetRows.length !== 2) {
  throw new Error(`Unexpected urgent scope: full=${fullTargets.length}, targets=${targets.length}, rows=${expectedRows}, excludedRows=${excludedKeywordCount}, excludedListings=${excludedTargetRows.length}`);
}
const scope = {
  status: "urgent_partial_recovery_scope",
  createdAt: new Date().toISOString(),
  canonicalTargetFile: "rank_targets.json",
  expectedListings: targets.length,
  expectedRows,
  excluded,
  excludedKeywordCount,
  targets,
};
const output = path.join(root, "rank_targets_urgent_excluding_CA_B0FY6JR3NK_US_B0FY67YPSM.json");
fs.writeFileSync(output, `${JSON.stringify(scope, null, 2)}\n`);
console.log(JSON.stringify({ output, expectedListings: targets.length, expectedRows, excluded }, null, 2));
