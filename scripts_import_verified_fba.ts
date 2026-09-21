import fs from "node:fs/promises";
import path from "node:path";
import { addSalesLog, deactivateListingsMissingFromSync, getListings } from "./server/db";
import { upsertSyncedListing } from "./server/rankEngine";

type Marketplace = "US" | "CA" | "JP";
type Candidate = {
  marketplace: Marketplace;
  asin: string;
  sku: string;
  title: string;
  category: "incense_sticks" | "incense_burner" | "incense_holder";
  category_name: string;
  image_url: string;
  price: string;
  currency: string;
  fba_stock: number;
  fba_inbound_working?: number;
  fba_inbound_shipped?: number;
  fba_inbound_receiving?: number;
  fba_inbound_total?: number;
  fulfillment_channel: "FBA";
  listing_status: "Active" | string;
  source_report_id: string;
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const sourceFiles = [
  path.join(root, "private_spapi_import", "us_ca_target_fba_candidates.json"),
  path.join(root, "private_spapi_import", "jp_target_fba_candidates.json"),
];

function normalizedPrice(raw: string): string {
  const match = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "0.00";
}

async function readCandidates(file: string): Promise<Candidate[]> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Candidate[];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const sourceRows = (await Promise.all(sourceFiles.map(readCandidates))).flat();
  const candidates = sourceRows.filter(item => item.fba_stock > 0);
  const invalid = sourceRows.filter(
    item =>
      !["US", "CA", "JP"].includes(item.marketplace) ||
      item.fulfillment_channel !== "FBA" ||
      item.listing_status.toLowerCase() !== "active" ||
      item.fba_stock <= 0 ||
      !item.asin ||
      !item.sku ||
      !item.title ||
      !["incense_sticks", "incense_burner", "incense_holder"].includes(item.category)
  );
  if (invalid.length > 0) {
    throw new Error(`Source audit failed: ${invalid.length} rows violate FBA/Active/stock/category rules`);
  }
  const naCount = candidates.filter(item => item.marketplace === "US" || item.marketplace === "CA").length;
  if (naCount === 0) throw new Error("North America source audit produced zero valid candidates; no import performed");

  const result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    deactivated: 0,
    rows: [] as Array<Record<string, unknown>>,
  };

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
      fbaInboundWorking: item.fba_inbound_working ?? 0,
      fbaInboundShipped: item.fba_inbound_shipped ?? 0,
      fbaInboundReceiving: item.fba_inbound_receiving ?? 0,
      fbaInboundTotal: item.fba_inbound_total ?? 0,
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
      "SP-API 实际清单同步",
      `已从 ${item.marketplace} 站全量报告同步；校验通过：FBA、Active、可售库存 ${item.fba_stock}、在途库存 ${item.fba_inbound_total ?? 0}。`,
      "真实数据同步",
      `来源报告：${item.source_report_id}；持续按转化优先级维护 6–20 个核心词并追踪自然排名。`
    );
    result.rows.push({ marketplace: item.marketplace, asin: item.asin, sku: item.sku, status: "imported_or_updated", fbaStock: item.fba_stock, fbaInboundTotal: item.fba_inbound_total ?? 0 });
  }

  for (const marketplace of ["US", "CA", "JP"] as Marketplace[]) {
    const activeKeys = candidates
      .filter(item => item.marketplace === marketplace)
      .map(item => `${item.asin}:${item.sku}`);
    result.deactivated += await deactivateListingsMissingFromSync(marketplace, activeKeys);
  }

  const current = await getListings();
  const violations = current.filter(
    item => item.fulfillmentChannel !== "FBA" || item.inventoryStatus !== "Active" || (item.fbaStock ?? 0) <= 0
  );
  if (violations.length > 0) {
    throw new Error(`Post-import audit failed: ${violations.length} retained records violate live FBA rules`);
  }

  const auditPath = path.join(root, "private_spapi_import", "three_market_import_execution_audit.json");
  const audit = {
    executedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidatesByMarket: Object.fromEntries(["US", "CA", "JP"].map(market => [market, candidates.filter(item => item.marketplace === market).length])),
    liveDatabaseCount: current.length,
    ...result,
    postImportViolations: violations.length,
  };
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  console.log(JSON.stringify(audit, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
