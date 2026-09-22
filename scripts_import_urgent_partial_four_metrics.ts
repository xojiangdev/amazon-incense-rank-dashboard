import fs from "node:fs/promises";
import path from "node:path";
import { applyPartialRealFourMetrics, type PartialFourMetricInput } from "./server/db";
import { dateKeyInTimeZone } from "./shared/rankTrend";

type MetricRow = PartialFourMetricInput;
type ListingFile = { marketplace: "US" | "CA" | "JP"; asin: string; results: MetricRow[] };
type Scope = {
  status: "urgent_partial_recovery_scope";
  expectedListings: number;
  expectedRows: number;
  excluded: Array<{ marketplace: "US" | "CA" | "JP"; asin: string; reason: string }>;
  excludedKeywordCount: number;
  targets: Array<{ marketplace: "US" | "CA" | "JP"; asin: string; keywords: string[] }>;
};
const root = path.resolve("private_spapi_import");
const scope = JSON.parse(await fs.readFile(path.join(root, "rank_targets_urgent_excluding_CA_B0FY6JR3NK_US_B0FY67YPSM.json"), "utf8")) as Scope;
const key = (marketplace: string, asin: string, keyword: string) => `${marketplace}:${asin.trim().toUpperCase()}:${keyword.trim().normalize("NFKC").toLowerCase()}`;
const expectedExclusions = new Set(["CA:B0FY6JR3NK", "US:B0FY67YPSM"]);
if (scope.status !== "urgent_partial_recovery_scope" || scope.expectedListings !== 40 || scope.expectedRows !== 334 || scope.excludedKeywordCount !== 36 || scope.excluded.length !== 2 || new Set(scope.excluded.map(item => `${item.marketplace}:${item.asin}`)).size !== 2 || ![...expectedExclusions].every(item => scope.excluded.some(exclusion => `${exclusion.marketplace}:${exclusion.asin}` === item))) {
  throw new Error("Urgent scope is not the approved 40-listing / 334-keyword scope");
}
const expected = new Set(scope.targets.flatMap(target => target.keywords.map(keyword => key(target.marketplace, target.asin, keyword))));
const dir = path.join(root, "four_metrics");
const rows: MetricRow[] = [];
for (const target of scope.targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  const parsed = JSON.parse(await fs.readFile(path.join(dir, filename), "utf8")) as ListingFile;
  if (parsed.marketplace !== target.marketplace || parsed.asin !== target.asin || !Array.isArray(parsed.results)) throw new Error(`Invalid listing metric file ${filename}`);
  rows.push(...parsed.results);
}
const actualKeys = rows.map(row => key(row.marketplace, row.asin, row.keyword));
const actual = new Set(actualKeys);
const missing = [...expected].filter(item => !actual.has(item));
const extra = [...actual].filter(item => !expected.has(item));
if (rows.length !== scope.expectedRows || actual.size !== rows.length || missing.length || extra.length) throw new Error(`Urgent metric batch mismatch: expected=${scope.expectedRows}, received=${rows.length}, unique=${actual.size}, missing=${missing.length}, extra=${extra.length}`);
for (const row of rows) {
  if (!Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999 || !Number.isInteger(row.page) || row.page < 1 || row.page > 4 || !Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999 || !Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999) throw new Error(`Invalid rank metric ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (!Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10 || (row.cprEstimate === null && row.monthlySalesAverage !== null) || (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || !Number.isInteger(row.monthlySalesAverage) || row.monthlySalesAverage < 0 || row.cprSampleCount < 5))) throw new Error(`Invalid CPR evidence ${row.marketplace}/${row.asin}/${row.keyword}`);
}
const snapshotDate = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
const result = await applyPartialRealFourMetrics(snapshotDate, rows, new Date(), scope.excluded);
if (result.updated !== scope.expectedRows || result.rank.updated !== scope.expectedRows || result.cpr.updated !== scope.expectedRows || result.ads.updated !== scope.expectedRows) throw new Error(`Urgent atomic write mismatch: ${JSON.stringify(result)}`);
const audit = { status: "urgent_partial_recovery_complete", snapshotDate, scope: { expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, excluded: scope.excluded, excludedKeywordCount: scope.excludedKeywordCount }, import: result };
await fs.writeFile(path.join(root, "four_metrics_urgent_partial_import_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
