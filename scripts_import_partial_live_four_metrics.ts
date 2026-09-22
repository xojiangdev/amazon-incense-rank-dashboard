import fs from "node:fs/promises";
import path from "node:path";
import { applyPartialRealFourMetrics, type PartialFourMetricInput } from "./server/db";
import { dateKeyInTimeZone } from "./shared/rankTrend";

type MetricRow = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  keyword: string;
  naturalRank: number;
  page: number;
  pcAdRank: number;
  pcSbvRank: number;
  cprEstimate: number | null;
  monthlySalesAverage: number | null;
  cprSampleCount: number;
};

type ListingMetricsFile = { marketplace: "US" | "CA" | "JP"; asin: string; results: MetricRow[] };
type PartialScope = {
  status: "temporary_partial_recovery_scope";
  expectedListings: number;
  expectedRows: number;
  excluded: { marketplace: "US" | "CA" | "JP"; asin: string; reason: string };
  excludedKeywordCount: number;
  targets: Array<{ marketplace: "US" | "CA" | "JP"; asin: string; keywords: string[] }>;
};

const root = path.resolve("private_spapi_import");
const scope = JSON.parse(await fs.readFile(path.join(root, "rank_targets_partial_excluding_CA_B0FY6JR3NK.json"), "utf8")) as PartialScope;
const dir = path.join(root, "four_metrics");
const key = (marketplace: string, asin: string, keyword: string) => `${marketplace}:${asin.trim().toUpperCase()}:${keyword.trim().normalize("NFKC").toLowerCase()}`;

if (scope.status !== "temporary_partial_recovery_scope" || scope.expectedListings !== 41 || scope.expectedRows !== 350 || scope.excluded.marketplace !== "CA" || scope.excluded.asin !== "B0FY6JR3NK" || scope.excludedKeywordCount !== 20) {
  throw new Error("Partial scope is not the approved 41-listing / 350-keyword recovery scope");
}

const expected = new Set(scope.targets.flatMap(target => target.keywords.map(keyword => key(target.marketplace, target.asin, keyword))));
const payloads: ListingMetricsFile[] = [];
for (const target of scope.targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  const parsed = JSON.parse(await fs.readFile(path.join(dir, filename), "utf8")) as ListingMetricsFile;
  if (parsed.marketplace !== target.marketplace || parsed.asin !== target.asin || !Array.isArray(parsed.results)) throw new Error(`Invalid listing metric file ${filename}`);
  payloads.push(parsed);
}

const rows = payloads.flatMap(payload => payload.results);
const actualKeys = rows.map(row => key(row.marketplace, row.asin, row.keyword));
const actual = new Set(actualKeys);
const missing = [...expected].filter(item => !actual.has(item));
const extra = [...actual].filter(item => !expected.has(item));
if (rows.length !== scope.expectedRows || actual.size !== rows.length || missing.length || extra.length) {
  throw new Error(`Partial metric batch mismatch: expected=${scope.expectedRows}, received=${rows.length}, unique=${actual.size}, missing=${missing.length}, extra=${extra.length}`);
}

for (const row of rows) {
  if (!Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999) throw new Error(`Invalid natural rank for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (!Number.isInteger(row.page) || row.page < 1 || row.page > 4) throw new Error(`Invalid page for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (!Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999) throw new Error(`Invalid PC ad rank for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (!Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999) throw new Error(`Invalid PC SBV rank for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (!Number.isInteger(row.cprSampleCount) || row.cprSampleCount < 0 || row.cprSampleCount > 10) throw new Error(`Invalid CPR sample count for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (row.cprEstimate === null && row.monthlySalesAverage !== null) throw new Error(`Invalid partial CPR evidence for ${row.marketplace}/${row.asin}/${row.keyword}`);
  if (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || !Number.isInteger(row.monthlySalesAverage) || row.monthlySalesAverage < 0 || row.cprSampleCount < 5)) {
    throw new Error(`Invalid calculated CPR evidence for ${row.marketplace}/${row.asin}/${row.keyword}`);
  }
}

const snapshotDate = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
const observedAt = new Date();
const result = await applyPartialRealFourMetrics(snapshotDate, rows as PartialFourMetricInput[], observedAt, scope.excluded);
if (result.updated !== scope.expectedRows || result.rank.updated !== scope.expectedRows || result.cpr.updated !== scope.expectedRows || result.ads.updated !== scope.expectedRows) {
  throw new Error(`Partial atomic write mismatch: updated=${result.updated}, rank=${result.rank.updated}, cpr=${result.cpr.updated}, ads=${result.ads.updated}`);
}

const audit = {
  status: "partial_recovery_complete",
  scope: { expectedListings: scope.expectedListings, expectedRows: scope.expectedRows, excluded: scope.excluded, excludedKeywordCount: scope.excludedKeywordCount },
  snapshotDate,
  import: result,
};
await fs.writeFile(path.join(root, "four_metrics_partial_import_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
