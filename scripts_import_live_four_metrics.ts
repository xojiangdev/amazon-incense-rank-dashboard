import fs from "node:fs/promises";
import path from "node:path";
import { applyCprEstimates, applyPcAdvertisingRanks, applyRealRankSnapshots, type CprEstimateInput, type PcAdvertisingRankInput, type RankSnapshotInput } from "./server/db";
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

type ListingMetricsFile = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  results: MetricRow[];
};

const root = path.resolve("private_spapi_import");
const targets = JSON.parse(await fs.readFile(path.join(root, "rank_targets.json"), "utf8")) as Array<{ marketplace: "US" | "CA" | "JP"; asin: string; keywords: string[] }>;
const dir = path.join(root, "four_metrics");
const expectedKey = (marketplace: string, asin: string, keyword: string) => `${marketplace}:${asin}:${keyword.trim().normalize("NFKC").toLowerCase()}`;
const expected = new Set(targets.flatMap(target => target.keywords.map(keyword => expectedKey(target.marketplace, target.asin, keyword))));

const payloads: ListingMetricsFile[] = [];
for (const target of targets) {
  const filename = `${target.marketplace}-${target.asin}.json`;
  const raw = await fs.readFile(path.join(dir, filename), "utf8");
  const parsed = JSON.parse(raw) as ListingMetricsFile;
  if (parsed.marketplace !== target.marketplace || parsed.asin !== target.asin || !Array.isArray(parsed.results)) {
    throw new Error(`Invalid listing metric file ${filename}`);
  }
  payloads.push(parsed);
}

const results = payloads.flatMap(item => item.results);
const receivedKeys = results.map(row => expectedKey(row.marketplace, row.asin, row.keyword));
const receivedSet = new Set(receivedKeys);
const missing = [...expected].filter(key => !receivedSet.has(key));
const extra = [...receivedSet].filter(key => !expected.has(key));
if (receivedKeys.length !== expected.size || receivedSet.size !== receivedKeys.length || missing.length || extra.length) {
  throw new Error(`Four-metric batch mismatch: expected=${expected.size}, received=${receivedKeys.length}, unique=${receivedSet.size}, missing=${missing.length}, extra=${extra.length}`);
}

for (const row of results) {
  if (!Number.isInteger(row.naturalRank) || row.naturalRank < 1 || row.naturalRank > 999) throw new Error(`Invalid natural rank for ${row.keyword}`);
  if (!Number.isInteger(row.page) || row.page < 1 || row.page > 4) throw new Error(`Invalid rank page for ${row.keyword}`);
  if (!Number.isInteger(row.pcAdRank) || row.pcAdRank < 1 || row.pcAdRank > 999) throw new Error(`Invalid PC ad rank for ${row.keyword}`);
  if (!Number.isInteger(row.pcSbvRank) || row.pcSbvRank < 1 || row.pcSbvRank > 999) throw new Error(`Invalid PC SBV rank for ${row.keyword}`);
  if (row.cprEstimate !== null && (!Number.isInteger(row.cprEstimate) || row.cprEstimate < 1 || row.monthlySalesAverage === null || row.cprSampleCount < 5)) {
    throw new Error(`Invalid CPR evidence for ${row.keyword}`);
  }
}

const snapshotDate = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
const ranks: RankSnapshotInput[] = results.map(row => ({ marketplace: row.marketplace, asin: row.asin, keyword: row.keyword, rank: row.naturalRank, page: row.page }));
const cpr: CprEstimateInput[] = results.map(row => ({ marketplace: row.marketplace, asin: row.asin, keyword: row.keyword, cprEstimate: row.cprEstimate, monthlySalesAverage: row.monthlySalesAverage, sampleCount: row.cprSampleCount, source: "dataforseo_amazon_pc_serp" }));
const ads: PcAdvertisingRankInput[] = results.map(row => ({ marketplace: row.marketplace, asin: row.asin, keyword: row.keyword, pcAdRank: row.pcAdRank, pcSbvRank: row.pcSbvRank, source: "dataforseo_amazon_pc_serp" }));

const rankResult = await applyRealRankSnapshots(snapshotDate, ranks);
if (rankResult.updated !== expected.size) throw new Error(`Natural rank write mismatch: ${rankResult.updated}/${expected.size}`);
const cprResult = await applyCprEstimates(cpr, new Date());
if (cprResult.updated !== expected.size) throw new Error(`CPR write mismatch: ${cprResult.updated}/${expected.size}`);
const adResult = await applyPcAdvertisingRanks(snapshotDate, ads);
if (adResult.updated !== expected.size) throw new Error(`PC advertising write mismatch: ${adResult.updated}/${expected.size}`);

const audit = {
  snapshotDate,
  expected: expected.size,
  rank: rankResult,
  cpr: cprResult,
  ads: adResult,
};
await fs.writeFile(path.join(root, "four_metrics_import_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
