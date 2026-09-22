import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scope = JSON.parse(await fsp.readFile(path.join(root, "rank_targets_urgent_excluding_CA_B0FY6JR3NK_US_B0FY67YPSM.json"), "utf8"));
const outputDir = path.join(root, "four_metrics");
const fragmentDir = path.join(root, "four_metrics_fragments");
const norm = value => value.trim().normalize("NFKC").toLowerCase();
const issues = [];
let coveredRows = 0;
for (const target of scope.targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  const finalPath = path.join(outputDir, filename);
  let rows = [];
  let source = "final";
  if (fs.existsSync(finalPath)) {
    const payload = JSON.parse(await fsp.readFile(finalPath, "utf8"));
    rows = payload.results ?? [];
  } else {
    source = "fragments";
    const prefix = `${target.marketplace}-${target.asin}-`;
    const fragmentNames = (await fsp.readdir(fragmentDir)).filter(name => name.startsWith(prefix) && name.endsWith(".json"));
    for (const name of fragmentNames) {
      const fragment = JSON.parse(await fsp.readFile(path.join(fragmentDir, name), "utf8"));
      rows.push(...(fragment.results ?? []));
    }
  }
  const expected = target.keywords.map(norm);
  const actual = rows.map(row => typeof row.keyword === "string" ? norm(row.keyword) : "<invalid>");
  const missing = target.keywords.filter(keyword => !actual.includes(norm(keyword)));
  const extra = rows.filter(row => typeof row.keyword !== "string" || !expected.includes(norm(row.keyword))).map(row => row.keyword ?? "<invalid>");
  const duplicate = [...new Set(actual.filter((item, index) => actual.indexOf(item) !== index))];
  coveredRows += rows.length;
  if (missing.length || extra.length || duplicate.length || rows.length !== target.keywords.length) issues.push({ marketplace: target.marketplace, asin: target.asin, source, expected: target.keywords.length, received: rows.length, missing, extra, duplicate });
}
const audit = { expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, coveredRows, issueCount: issues.length, issues };
await fsp.writeFile(path.join(root, "four_metrics_urgent_coverage_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
if (issues.length) process.exitCode = 2;
