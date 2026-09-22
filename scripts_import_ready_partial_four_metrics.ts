import fs from "node:fs/promises";
import path from "node:path";
import { applyPartialRealFourMetrics, type PartialFourMetricInput } from "./server/db";
import { dateKeyInTimeZone } from "./shared/rankTrend";

type ListingFile = { marketplace: "US" | "CA" | "JP"; asin: string; results: PartialFourMetricInput[] };
type Scope = {
  status: "ready_partial_recovery_scope";
  expectedListings: number;
  expectedRows: number;
  excluded: Array<{ marketplace: "US" | "CA" | "JP"; asin: string; reason: string }>;
  excludedKeywordCount: number;
  targets: Array<{ marketplace: "US" | "CA" | "JP"; asin: string; keywords: string[] }>;
};
const root = path.resolve("private_spapi_import");
const scope = JSON.parse(await fs.readFile(path.join(root, "rank_targets_ready_excluding_3_temporary_listings.json"), "utf8")) as Scope;
const expectedExcluded = new Set(["CA:B0FY6JR3NK", "US:B0FY67YPSM", "US:B0FY67W88Z"]);
const metricKey = (marketplace: string, asin: string, keyword: string) => `${marketplace}:${asin.trim().toUpperCase()}:${keyword.trim().normalize("NFKC").toLowerCase()}`;
if (scope.status !== "ready_partial_recovery_scope" || scope.expectedListings !== 39 || scope.expectedRows !== 314 || scope.excludedKeywordCount !== 56 || scope.excluded.length !== 3 || new Set(scope.excluded.map(item => `${item.marketplace}:${item.asin}`)).size !== 3 || ![...expectedExcluded].every(key => scope.excluded.some(item => `${item.marketplace}:${item.asin}` === key))) {
  throw new Error("Ready scope is not the approved 39-listing / 314-keyword recovery scope");
}
const expected = new Set(scope.targets.flatMap(target => target.keywords.map(keyword => metricKey(target.marketplace, target.asin, keyword))));
const rows: PartialFourMetricInput[] = [];
for (const target of scope.targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  const payload = JSON.parse(await fs.readFile(path.join(root, "four_metrics", filename), "utf8")) as ListingFile;
  if (payload.marketplace !== target.marketplace || payload.asin !== target.asin || !Array.isArray(payload.results)) throw new Error(`Invalid output ${filename}`);
  rows.push(...payload.results);
}
const actualKeys = rows.map(row => metricKey(row.marketplace, row.asin, row.keyword));
const actual = new Set(actualKeys);
const missing = [...expected].filter(key => !actual.has(key));
const extra = [...actual].filter(key => !expected.has(key));
if (rows.length !== scope.expectedRows || actual.size !== rows.length || missing.length || extra.length) throw new Error(`Ready metric batch mismatch: expected=${scope.expectedRows}, received=${rows.length}, unique=${actual.size}, missing=${missing.length}, extra=${extra.length}`);
for (const row of rows) {
  if (!Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999 || !Number.isInteger(row.page) || row.page < 1 || row.page > 4 || !Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999 || !Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999 || !Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10) throw new Error(`Invalid metric fields ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (row.cprEstimate === null && row.monthlySalesAverage !== null) throw new Error(`Invalid partial CPR ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || !Number.isInteger(row.monthlySalesAverage) || row.monthlySalesAverage < 0 || row.cprSampleCount < 5)) throw new Error(`Invalid calculated CPR ${row.marketplace}/${row.asin}/${row.keyword}`);
}
const snapshotDate = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
const result = await applyPartialRealFourMetrics(snapshotDate, rows, new Date(), scope.excluded);
if (result.updated !== scope.expectedRows || result.rank.updated !== scope.expectedRows || result.cpr.updated !== scope.expectedRows || result.ads.updated !== scope.expectedRows) throw new Error(`Ready atomic write mismatch: ${JSON.stringify(result)}`);
const audit = { status: "ready_partial_recovery_complete", snapshotDate, scope: { expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, excluded: scope.excluded, excludedKeywordCount: scope.excludedKeywordCount }, import: result };
await fs.writeFile(path.join(root, "four_metrics_ready_partial_import_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
