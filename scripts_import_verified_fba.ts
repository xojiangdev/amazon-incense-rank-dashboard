import fs from "node:fs/promises";
import path from "node:path";
import { addSalesLog, getListings } from "./server/db";
import { upsertSyncedListing } from "./server/rankEngine";

type Candidate = {
  marketplace: "US" | "CA";
  asin: string;
  sku: string;
  title: string;
  category: "incense_sticks" | "incense_burner" | "incense_holder";
  category_name: string;
  image_url: string;
  price: string;
  currency: string;
  fba_stock: number;
  fulfillment_channel: "FBA";
  listing_status: "Active" | string;
  source_report_id: string;
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const inputPath = path.join(root, "private_spapi_import", "us_ca_target_fba_candidates.json");

function normalizedPrice(raw: string): string {
  const match = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "0.00";
}

async function main() {
  const raw = await fs.readFile(inputPath, "utf8");
  const candidates = JSON.parse(raw) as Candidate[];
  const invalid = candidates.filter(
    item =>
      !["US", "CA"].includes(item.marketplace) ||
      item.fulfillment_channel !== "FBA" ||
      item.listing_status.toLowerCase() !== "active" ||
      item.fba_stock <= 0 ||
      !item.asin ||
      !item.sku ||
      !item.title ||
      !["incense_sticks", "incense_burner", "incense_holder"].includes(item.category)
  );

  if (invalid.length > 0) {
    throw new Error(`Source audit failed: ${invalid.length} candidate rows violate FBA/Active/stock/category rules`);
  }
  if (candidates.length === 0) {
    throw new Error("Source audit produced zero valid US/CA FBA listing candidates; no import performed");
  }

  const result = { imported: 0, updated: 0, skipped: 0, rejected: 0, rows: [] as Array<Record<string, unknown>> };

  for (const item of candidates) {
    const upsert = await upsertSyncedListing({
      marketplace: item.marketplace,
      asin: item.asin,
      sku: item.sku,
      title: item.title,
      categoryName: item.category_name,
      imageUrl: item.image_url || undefined,
      price: normalizedPrice(item.price),
      currency: item.currency,
      fbaStock: item.fba_stock,
      fulfillmentChannel: "FBA",
      inventoryStatus: "Active",
      assignedSales: "销售组",
    });

    if (!upsert || "skipped" in upsert) {
      result.skipped += 1;
      result.rows.push({ marketplace: item.marketplace, asin: item.asin, sku: item.sku, status: "skipped", detail: upsert });
      continue;
    }

    const listingId = upsert.id;
    if ("created" in upsert) result.imported += 1;
    if ("updated" in upsert) result.updated += 1;
    await addSalesLog(
      listingId,
      "SP-API 实际清单导入",
      `已从 ${item.marketplace} 站 Seller Central 全量商品报告导入；校验通过：FBA、Active、可售库存 ${item.fba_stock}。`,
      "真实数据建档",
      `来源报告：${item.source_report_id}；后续将按转化优先级建立 6–20 个核心词并追踪自然排名。`
    );
    result.rows.push({ marketplace: item.marketplace, asin: item.asin, sku: item.sku, status: "imported_or_updated", fbaStock: item.fba_stock });
  }

  const current = await getListings();
  const violations = current.filter(item => item.fulfillmentChannel !== "FBA" || item.inventoryStatus !== "Active" || (item.fbaStock ?? 0) <= 0);
  if (violations.length > 0) {
    throw new Error(`Post-import audit failed: ${violations.length} retained records do not meet FBA/Active/stock requirements`);
  }

  const auditPath = path.join(root, "private_spapi_import", "us_ca_import_execution_audit.json");
  await fs.writeFile(
    auditPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        candidateCount: candidates.length,
        liveDatabaseCount: current.length,
        ...result,
        postImportViolations: violations.length,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ candidateCount: candidates.length, ...result, liveDatabaseCount: current.length, postImportViolations: violations.length }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
