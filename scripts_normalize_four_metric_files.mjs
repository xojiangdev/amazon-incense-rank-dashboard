import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const dir = path.join(root, "four_metrics");
const files = (await fs.readdir(dir)).filter(file => file.endsWith(".json")).sort();
const normalized = [];
for (const file of files) {
  const source = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
  if (typeof source.marketplace !== "string" || typeof source.asin !== "string" || !Array.isArray(source.results)) throw new Error(`Invalid metric envelope: ${file}`);
  let clearedUnsupportedCprValues = 0;
  const results = source.results.map((row, index) => {
    const naturalRank = row.naturalRank ?? row.rank;
    let cprEstimate = row.cprEstimate;
    let monthlySalesAverage = row.monthlySalesAverage ?? row.cprMonthlySalesAverage;
    if (row.naturalRank !== undefined && row.rank !== undefined && row.naturalRank !== row.rank) throw new Error(`Conflicting natural rank aliases in ${file} row ${index}`);
    if (row.monthlySalesAverage !== undefined && row.cprMonthlySalesAverage !== undefined && row.monthlySalesAverage !== row.cprMonthlySalesAverage) throw new Error(`Conflicting monthly sales aliases in ${file} row ${index}`);
    if (typeof row.keyword !== "string" || !row.keyword.trim() || !Number.isInteger(naturalRank) || naturalRank < 1 || naturalRank > 999 || !Number.isInteger(row.page) || row.page < 1 || row.page > 4 || !Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999 || !Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999 || !Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10) throw new Error(`Invalid source metric values in ${file} row ${index}`);
    // Under the CPR contract, fewer than five samples or a null CPR never permits
    // a displayed monthly average. Clear only that unsupported claim; preserve the
    // provider's true sample count so the UI shows "样本不足" rather than a value.
    if (row.cprSampleCount < 5 || cprEstimate === null) {
      if (cprEstimate !== null || monthlySalesAverage !== null) clearedUnsupportedCprValues += 1;
      cprEstimate = null;
      monthlySalesAverage = null;
    }
    if (cprEstimate !== null && (!Number.isInteger(cprEstimate) || cprEstimate < 1 || !Number.isInteger(monthlySalesAverage) || monthlySalesAverage < 0)) throw new Error(`Invalid calculated CPR value in ${file} row ${index}`);
    return {
      marketplace: source.marketplace,
      asin: source.asin,
      keyword: row.keyword,
      naturalRank,
      page: row.page,
      pcAdRank: row.pcAdRank,
      pcSbvRank: row.pcSbvRank,
      cprEstimate,
      monthlySalesAverage,
      cprSampleCount: row.cprSampleCount,
    };
  });
  await fs.writeFile(path.join(dir, file), `${JSON.stringify({ marketplace: source.marketplace, asin: source.asin, results }, null, 2)}\n`);
  normalized.push({ file, rows: results.length, clearedUnsupportedCprValues });
}
const audit = { status: "field_alias_normalization_complete", normalized, totalRows: normalized.reduce((sum, item) => sum + item.rows, 0) };
await fs.writeFile(path.join(root, "four_metrics_field_normalization_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
