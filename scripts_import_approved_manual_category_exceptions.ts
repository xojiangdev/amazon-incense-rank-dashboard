import fs from "node:fs/promises";
import path from "node:path";
import { addSalesLog } from "./server/db";
import { upsertSyncedListing } from "./server/rankEngine";

type FbaCheck = {
  asin: string;
  sku: string;
  found: boolean;
  fulfillableQuantity: number | null;
  eligible: boolean;
  inboundWorkingQuantity: number | null;
  inboundShippedQuantity: number | null;
  inboundReceivingQuantity: number | null;
};

type FbaCheckDocument = { ok: boolean; marketplace: "US"; results: FbaCheck[] };

const titles: Record<string, string> = {
  B0H3J6LR1K: "Yinjiyue Sandalwood Essential Oil 10ml, Pure Natural Aromatherapy Oil for Diffuser Humidifier and Massage",
  B0HJ1GPC2S: "yinjiyue Weighted Eye Mask for Sleeping, Reversible Cool-Touch & Plush Sleep Mask, Quiet Adjustable Closure, Contoured Nose Fit for Bedtime, Naps & Travel, Navy",
};

async function main() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const sourcePath = path.join(root, "private_spapi_import", "manual_category_exception_fba_check.json");
  const auditPath = path.join(root, "private_spapi_import", "manual_category_exception_import_audit.json");
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8")) as FbaCheckDocument;
  if (!source.ok) throw new Error("FBA eligibility source did not complete successfully");

  const audit = {
    executedAt: new Date().toISOString(),
    source: "targeted SP-API FBA inventory verification",
    imported: [] as Array<Record<string, unknown>>,
    skipped: [] as Array<Record<string, unknown>>,
  };

  for (const item of source.results) {
    const title = titles[item.asin];
    if (!title) {
      audit.skipped.push({ asin: item.asin, reason: "ASIN is not in the one-time approved exception set" });
      continue;
    }
    if (!item.eligible || !item.fulfillableQuantity || item.fulfillableQuantity <= 0) {
      audit.skipped.push({
        asin: item.asin,
        reason: "No verified positive FBA fulfillable stock; no active dashboard Listing was created",
        fulfillableQuantity: item.fulfillableQuantity,
        inboundShippedQuantity: item.inboundShippedQuantity,
      });
      continue;
    }

    const result = await upsertSyncedListing({
      marketplace: "US",
      asin: item.asin,
      sku: item.sku,
      title,
      price: "9.99",
      currency: "USD",
      fbaStock: item.fulfillableQuantity,
      fbaInboundWorking: item.inboundWorkingQuantity ?? 0,
      fbaInboundShipped: item.inboundShippedQuantity ?? 0,
      fbaInboundReceiving: item.inboundReceivingQuantity ?? 0,
      fbaInboundTotal: (item.inboundWorkingQuantity ?? 0) + (item.inboundShippedQuantity ?? 0) + (item.inboundReceivingQuantity ?? 0),
      fulfillmentChannel: "FBA",
      inventoryStatus: "Active",
      assignedSales: "销售组",
      manualCategoryOverride: true,
    });

    if (!result || "skipped" in result) {
      audit.skipped.push({ asin: item.asin, reason: "Manual import guard rejected record", result });
      continue;
    }
    await addSalesLog(
      result.id,
      "人工类目豁免",
      `经用户授权，已作为手动类目豁免导入。SP-API 核验：FBA、Active、可售库存 ${item.fulfillableQuantity}、在途 ${((item.inboundWorkingQuantity ?? 0) + (item.inboundShippedQuantity ?? 0) + (item.inboundReceivingQuantity ?? 0))}。`,
      "人工类目豁免导入",
      "此记录不受香道类目守卫限制，但仍受 FBA、Active、正可售库存条件约束；自动香道同步不会覆盖或停用该授权记录。"
    );
    audit.imported.push({ asin: item.asin, sku: item.sku, fbaStock: item.fulfillableQuantity, result });
  }

  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
  console.log(JSON.stringify(audit, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
