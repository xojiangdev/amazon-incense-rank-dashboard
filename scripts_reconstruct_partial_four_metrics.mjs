import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scopeFile = process.env.METRIC_SCOPE_FILE ?? "rank_targets_partial_excluding_CA_B0FY6JR3NK.json";
const scope = JSON.parse(await fsp.readFile(path.join(root, scopeFile), "utf8"));
const outputDir = path.join(root, "four_metrics");
const fragmentDir = path.join(root, "four_metrics_fragments");
const normalizedKey = (marketplace, asin, keyword) => `${marketplace}:${asin.trim().toUpperCase()}:${keyword.trim().normalize("NFKC").toLowerCase()}`;
const validateRow = row => {
  if (!Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999) throw new Error(`Invalid naturalRank: ${row.keyword}`);
  if (!Number.isInteger(row.page) || row.page < 1 || row.page > 4) throw new Error(`Invalid page: ${row.keyword}`);
  if (!Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999) throw new Error(`Invalid pcAdRank: ${row.keyword}`);
  if (!Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999) throw new Error(`Invalid pcSbvRank: ${row.keyword}`);
  if (!Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10) throw new Error(`Invalid cprSampleCount: ${row.keyword}`);
  if (row.cprEstimate === null && row.monthlySalesAverage !== null) throw new Error(`Partial CPR evidence: ${row.keyword}`);
  if (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || !Number.isInteger(row.monthlySalesAverage) || row.monthlySalesAverage < 0 || row.cprSampleCount < 5)) throw new Error(`Invalid calculated CPR: ${row.keyword}`);
};

await fsp.mkdir(outputDir, { recursive: true });
const targets = scope.targets;
const pending = [];
for (const target of targets) {
  const name = `${target.marketplace}-${target.asin}.json`;
  const outputPath = path.join(outputDir, name);
  if (fs.existsSync(outputPath)) {
    const parsed = JSON.parse(await fsp.readFile(outputPath, "utf8"));
    const expected = new Set(target.keywords.map(keyword => normalizedKey(target.marketplace, target.asin, keyword)));
    const actual = new Set(parsed.results?.map(row => normalizedKey(row.marketplace, row.asin, row.keyword)) ?? []);
    if (parsed.marketplace !== target.marketplace || parsed.asin !== target.asin || !Array.isArray(parsed.results) || parsed.results.length !== expected.size || actual.size !== expected.size || [...expected].some(key => !actual.has(key)) || [...actual].some(key => !expected.has(key))) throw new Error(`Existing output file is invalid: ${name}`);
    parsed.results.forEach(validateRow);
  } else {
    pending.push(target);
  }
}

if (!fs.existsSync(fragmentDir)) throw new Error("Fragment directory is absent");
const stagingDir = path.join(root, `four_metrics_reconstructed_${process.pid}`);
await fsp.mkdir(stagingDir, { recursive: true });
const reconstructed = [];
try {
  for (const target of pending) {
    const prefix = `${target.marketplace}-${target.asin}-`;
    const names = (await fsp.readdir(fragmentDir)).filter(name => name.startsWith(prefix) && name.endsWith(".json")).sort();
    if (!names.length) throw new Error(`No fragments found for ${target.marketplace}/${target.asin}`);
    const rows = [];
    for (const name of names) {
      const part = JSON.parse(await fsp.readFile(path.join(fragmentDir, name), "utf8"));
      if (part.marketplace !== target.marketplace || part.asin !== target.asin || !Array.isArray(part.results)) throw new Error(`Invalid fragment ${name}`);
      rows.push(...part.results);
    }
    const expected = new Set(target.keywords.map(keyword => normalizedKey(target.marketplace, target.asin, keyword)));
    const actualKeys = rows.map(row => normalizedKey(row.marketplace, row.asin, row.keyword));
    const actual = new Set(actualKeys);
    if (rows.length !== expected.size || actual.size !== actualKeys.length || [...expected].some(key => !actual.has(key)) || [...actual].some(key => !expected.has(key))) throw new Error(`Fragment coverage mismatch for ${target.marketplace}/${target.asin}: expected=${expected.size}, received=${rows.length}, unique=${actual.size}`);
    rows.forEach(validateRow);
    const ordered = target.keywords.map(keyword => rows.find(row => normalizedKey(row.marketplace, row.asin, row.keyword) === normalizedKey(target.marketplace, target.asin, keyword)));
    const content = { marketplace: target.marketplace, asin: target.asin, results: ordered };
    const filename = `${target.marketplace}-${target.asin}.json`;
    await fsp.writeFile(path.join(stagingDir, filename), `${JSON.stringify(content, null, 2)}\n`);
    reconstructed.push({ marketplace: target.marketplace, asin: target.asin, rows: rows.length, fragments: names.length });
  }
  for (const item of reconstructed) {
    const filename = `${item.marketplace}-${item.asin}.json`;
    await fsp.rename(path.join(stagingDir, filename), path.join(outputDir, filename));
  }
} finally {
  await fsp.rm(stagingDir, { recursive: true, force: true });
}

const finalFiles = await fsp.readdir(outputDir);
const totalRows = [];
for (const target of targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  if (!finalFiles.includes(filename)) throw new Error(`Missing final output after reconstruction: ${filename}`);
  const parsed = JSON.parse(await fsp.readFile(path.join(outputDir, filename), "utf8"));
  totalRows.push(...parsed.results);
}
const expectedAll = new Set(targets.flatMap(target => target.keywords.map(keyword => normalizedKey(target.marketplace, target.asin, keyword))));
const actualAll = new Set(totalRows.map(row => normalizedKey(row.marketplace, row.asin, row.keyword)));
if (targets.length !== scope.expectedListings || totalRows.length !== scope.expectedRows || actualAll.size !== totalRows.length || actualAll.size !== expectedAll.size || [...expectedAll].some(key => !actualAll.has(key))) throw new Error(`Final partial recovery validation failed: listings=${targets.length}/${scope.expectedListings}, rows=${totalRows.length}/${scope.expectedRows}, unique=${actualAll.size}`);
const audit = { status: "partial_reconstruction_valid", expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, excluded: scope.excluded, reconstructed, finalRows: totalRows.length };
await fsp.writeFile(path.join(root, "four_metrics_partial_reconstruction_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
