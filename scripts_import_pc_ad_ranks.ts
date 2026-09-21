import fs from "node:fs/promises";
import path from "node:path";
import { applyPcAdvertisingRanks, type PcAdvertisingRankInput } from "./server/db";
import { dateKeyInTimeZone } from "./shared/rankTrend";

type ResultRow = PcAdvertisingRankInput;

const root = path.resolve("private_spapi_import");
const expectedFiles = ["pc_ad_results_us.json", "pc_ad_results_ca.json"];
const normalizeKey = (row: Pick<ResultRow, "marketplace" | "asin" | "keyword">) =>
  `${row.marketplace}:${row.asin.trim().toUpperCase()}:${row.keyword.trim().normalize("NFKC").toLowerCase()}`;

async function readRows(filename: string): Promise<ResultRow[]> {
  const filePath = path.join(root, filename);
  const raw = await fs.readFile(filePath, "utf8");
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error(`${filename} must be a JSON array`);
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`${filename}[${index}] must be an object`);
    const item = row as Record<string, unknown>;
    if (!(["US", "CA", "JP"] as const).includes(item.marketplace as "US" | "CA" | "JP")) throw new Error(`${filename}[${index}].marketplace is invalid`);
    if (typeof item.asin !== "string" || item.asin.length !== 10) throw new Error(`${filename}[${index}].asin is invalid`);
    if (typeof item.keyword !== "string" || !item.keyword.trim()) throw new Error(`${filename}[${index}].keyword is invalid`);
    if (!Number.isInteger(item.pcAdRank) || (item.pcAdRank as number) < 1 || (item.pcAdRank as number) > 999) throw new Error(`${filename}[${index}].pcAdRank is invalid`);
    if (!Number.isInteger(item.pcSbvRank) || (item.pcSbvRank as number) < 1 || (item.pcSbvRank as number) > 999) throw new Error(`${filename}[${index}].pcSbvRank is invalid`);
    if (item.source !== "dataforseo_amazon_pc_serp") throw new Error(`${filename}[${index}].source is invalid`);
    return item as unknown as ResultRow;
  });
}

const rows = (await Promise.all(expectedFiles.map(readRows))).flat();
const keys = rows.map(normalizeKey);
if (new Set(keys).size !== keys.length) throw new Error(`Duplicate PC ad result key detected: total=${keys.length}, unique=${new Set(keys).size}`);

const snapshotDate = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
const result = await applyPcAdvertisingRanks(snapshotDate, rows);
if (result.expected !== result.updated) throw new Error(`PC advertising write mismatch: expected=${result.expected}, updated=${result.updated}`);

const audit = {
  importedAt: new Date().toISOString(),
  snapshotDate,
  sourceFiles: expectedFiles,
  ...result,
  markets: rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.marketplace] = (acc[row.marketplace] ?? 0) + 1;
    return acc;
  }, {}),
};
await fs.writeFile(path.join(root, "pc_ad_rank_import_audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
