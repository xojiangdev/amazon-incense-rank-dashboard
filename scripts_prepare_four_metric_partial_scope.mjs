import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const fullTargetPath = path.join(root, "rank_targets.json");
const outputPath = path.join(root, "rank_targets_partial_excluding_CA_B0FY6JR3NK.json");
const fullTargets = JSON.parse(fs.readFileSync(fullTargetPath, "utf8"));

const excluded = { marketplace: "CA", asin: "B0FY6JR3NK", reason: "User-directed temporary skip after collection task timed out" };
const targets = fullTargets.filter(target => !(target.marketplace === excluded.marketplace && target.asin === excluded.asin));
const excludedTarget = fullTargets.find(target => target.marketplace === excluded.marketplace && target.asin === excluded.asin);
if (!excludedTarget) throw new Error("Requested temporary exclusion was not found in the canonical rank targets");

const expectedRows = targets.reduce((sum, target) => sum + target.keywords.length, 0);
const excludedRows = excludedTarget.keywords.length;
if (fullTargets.length !== 42 || targets.length !== 41 || expectedRows !== 350 || excludedRows !== 20) {
  throw new Error(`Unexpected partial scope: full=${fullTargets.length}, targets=${targets.length}, rows=${expectedRows}, excludedRows=${excludedRows}`);
}

const scope = {
  status: "temporary_partial_recovery_scope",
  createdAt: new Date().toISOString(),
  canonicalTargetFile: "rank_targets.json",
  expectedListings: targets.length,
  expectedRows,
  excluded,
  excludedKeywordCount: excludedRows,
  targets,
};
fs.writeFileSync(outputPath, `${JSON.stringify(scope, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, expectedListings: targets.length, expectedRows, excluded }, null, 2));
