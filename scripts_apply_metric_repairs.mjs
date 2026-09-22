import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scopeFile = process.env.METRIC_SCOPE_FILE ?? "rank_targets_urgent_excluding_CA_B0FY6JR3NK_US_B0FY67YPSM.json";
const planFile = process.env.METRIC_REPAIR_PLAN_FILE ?? "four_metric_correction_plan.json";
const scope = JSON.parse(await fsp.readFile(path.join(root, scopeFile), "utf8"));
const plan = JSON.parse(await fsp.readFile(path.join(root, planFile), "utf8"));
const outputDir = path.join(root, "four_metrics");
const fragmentDir = path.join(root, "four_metrics_fragments");
const repairDir = path.join(root, "four_metrics_repairs");
const n = value => value.trim().normalize("NFKC").toLowerCase();
const rowKey = row => `${row.marketplace}:${row.asin.trim().toUpperCase()}:${n(row.keyword)}`;
const validateRow = row => {
  if (!row || typeof row.keyword !== "string" || !Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999 || !Number.isInteger(row.page) || row.page < 1 || row.page > 4 || !Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999 || !Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999 || !Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10) throw new Error(`Invalid metric row ${row?.keyword ?? "unknown"}`);
  if (row.cprEstimate === null && row.monthlySalesAverage !== null) throw new Error(`Invalid null CPR evidence ${row.keyword}`);
  if (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || !Number.isInteger(row.monthlySalesAverage) || row.monthlySalesAverage < 0 || row.cprSampleCount < 5)) throw new Error(`Invalid calculated CPR ${row.keyword}`);
};
const repairMap = new Map();
for (const job of plan.jobs) {
  const file = `${job.marketplace}-${job.asin}-${job.id}.json`;
  const payload = JSON.parse(await fsp.readFile(path.join(repairDir, file), "utf8"));
  if (payload.marketplace !== job.marketplace || payload.asin !== job.asin || !Array.isArray(payload.results) || payload.results.length !== job.keywords.length) throw new Error(`Invalid repair envelope ${file}`);
  const expected = new Set(job.keywords.map(keyword => `${job.marketplace}:${job.asin}:${n(keyword)}`));
  const actual = new Set(payload.results.map(rowKey));
  if (actual.size !== payload.results.length || actual.size !== expected.size || [...expected].some(key => !actual.has(key)) || [...actual].some(key => !expected.has(key))) throw new Error(`Repair key mismatch ${file}`);
  for (const row of payload.results) {
    validateRow(row);
    const key = rowKey(row);
    if (repairMap.has(key)) throw new Error(`Duplicate repair key ${key}`);
    repairMap.set(key, row);
  }
}

const stage = path.join(root, `four_metrics_repaired_${process.pid}`);
await fsp.mkdir(stage, { recursive: true });
const changes = [];
try {
  for (const target of scope.targets) {
    const finalFile = `${target.marketplace}-${target.asin}.json`;
    const finalPath = path.join(outputDir, finalFile);
    let sourceRows = [];
    if (fs.existsSync(finalPath)) {
      sourceRows = JSON.parse(await fsp.readFile(finalPath, "utf8")).results;
    } else {
      const prefix = `${target.marketplace}-${target.asin}-`;
      const fragmentNames = (await fsp.readdir(fragmentDir)).filter(name => name.startsWith(prefix) && name.endsWith(".json"));
      for (const name of fragmentNames) sourceRows.push(...JSON.parse(await fsp.readFile(path.join(fragmentDir, name), "utf8")).results);
    }
    const byKey = new Map();
    for (const row of sourceRows) {
      if (!row || typeof row.keyword !== "string") continue;
      const key = rowKey({ ...row, marketplace: target.marketplace, asin: target.asin });
      if (!byKey.has(key)) byKey.set(key, { ...row, marketplace: target.marketplace, asin: target.asin });
    }
    for (const keyword of target.keywords) {
      const key = `${target.marketplace}:${target.asin}:${n(keyword)}`;
      if (repairMap.has(key)) byKey.set(key, repairMap.get(key));
    }
    const results = target.keywords.map(keyword => byKey.get(`${target.marketplace}:${target.asin}:${n(keyword)}`));
    if (results.some(row => !row)) throw new Error(`Unresolved target after repairs ${target.marketplace}/${target.asin}`);
    results.forEach(validateRow);
    const keys = results.map(rowKey);
    if (new Set(keys).size !== results.length) throw new Error(`Duplicate output target after repairs ${target.marketplace}/${target.asin}`);
    await fsp.writeFile(path.join(stage, finalFile), `${JSON.stringify({ marketplace: target.marketplace, asin: target.asin, results }, null, 2)}\n`);
    changes.push({ marketplace: target.marketplace, asin: target.asin, rows: results.length, repairCount: results.filter(row => repairMap.has(rowKey(row))).length });
  }
  for (const change of changes) await fsp.rename(path.join(stage, `${change.marketplace}-${change.asin}.json`), path.join(outputDir, `${change.marketplace}-${change.asin}.json`));
} finally {
  await fsp.rm(stage, { recursive: true, force: true });
}

const allRows = [];
for (const target of scope.targets) allRows.push(...JSON.parse(await fsp.readFile(path.join(outputDir, `${target.marketplace}-${target.asin}.json`), "utf8")).results);
const expectedKeys = new Set(scope.targets.flatMap(target => target.keywords.map(keyword => `${target.marketplace}:${target.asin}:${n(keyword)}`)));
const actualKeys = new Set(allRows.map(rowKey));
if (allRows.length !== scope.expectedRows || actualKeys.size !== allRows.length || actualKeys.size !== expectedKeys.size || [...expectedKeys].some(key => !actualKeys.has(key))) throw new Error(`Final urgent coverage mismatch: expected=${scope.expectedRows}, rows=${allRows.length}, unique=${actualKeys.size}`);
const audit = { status: "urgent_repair_merge_valid", expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, repairRows: repairMap.size, finalRows: allRows.length, changes };
await fsp.writeFile(path.join(root, "four_metrics_urgent_repair_merge_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
