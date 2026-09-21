import { and, desc, eq } from "drizzle-orm";
import { dailyRankSnapshots, keywords, listings, salesLogs } from "../drizzle/schema";
import { getDb, getStoreSettings } from "./db";

// 严格限定的品类过滤关键词
const INCENSE_STICK_KEYWORDS = ["incense stick", "incense sticks", "agarwood", "sandalwood incense", "线香", "香条"];
const INCENSE_BURNER_KEYWORDS = ["incense burner", "backflow burner", "waterfall burner", "censer", "香炉", "倒流炉"];
const INCENSE_HOLDER_KEYWORDS = ["incense holder", "ash catcher", "incense tray", "incense plate", "香插", "香托", "香盘"];

export function classifyIncenseCategory(title: string, categoryName: string = ""): "incense_sticks" | "incense_burner" | "incense_holder" | "other" {
  const text = `${title} ${categoryName}`.toLowerCase();
  if (INCENSE_HOLDER_KEYWORDS.some(k => text.includes(k))) return "incense_holder";
  if (INCENSE_BURNER_KEYWORDS.some(k => text.includes(k))) return "incense_burner";
  if (INCENSE_STICK_KEYWORDS.some(k => text.includes(k))) return "incense_sticks";
  if (text.includes("incense") && text.includes("stick")) return "incense_sticks";
  return "other";
}

export interface SyncListingInput {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  sku?: string;
  title: string;
  price?: string;
  currency?: string;
  categoryName?: string;
  imageUrl?: string;
  fbaStock?: number;
  fbaInboundWorking?: number;
  fbaInboundShipped?: number;
  fbaInboundReceiving?: number;
  fbaInboundTotal?: number;
  fulfillmentChannel?: "FBA" | "FBM";
  inventoryStatus?: "Active" | "Inactive" | "Out of Stock";
  assignedSales?: string;
}

export async function upsertSyncedListing(item: SyncListingInput) {
  const db = await getDb();
  if (!db) return null;
  const store = await getStoreSettings();
  if (!store) return null;

  // 仅允许亚马逊配送且当前可售的商品进入排名池；FBM、停售、断货一律拒绝。
  if (item.fulfillmentChannel && item.fulfillmentChannel !== "FBA") {
    return { skipped: true, reason: "FBM listing excluded" };
  }
  if (item.inventoryStatus && item.inventoryStatus !== "Active") {
    return { skipped: true, reason: "Non-active listing excluded" };
  }
  if (item.fbaStock !== undefined && item.fbaStock <= 0) {
    return { skipped: true, reason: "FBA listing has no fulfillable inventory" };
  }
  const category = classifyIncenseCategory(item.title, item.categoryName || "");
  if (category === "other") {
    // 仅限线香和香炉香插类目，非目标品类自动略过
    return { skipped: true, reason: "Non-incense category" };
  }

  const existing = await db
    .select()
    .from(listings)
    .where(and(eq(listings.marketplace, item.marketplace), eq(listings.asin, item.asin)))
    .limit(1);

  if (existing.length > 0) {
    const target = existing[0];
    await db
      .update(listings)
      .set({
        title: item.title,
        sku: item.sku ?? target.sku,
        category,
        categoryName: item.categoryName ?? target.categoryName,
        price: item.price ?? target.price,
        currency: item.currency ?? target.currency,
        imageUrl: item.imageUrl ?? target.imageUrl,
        fulfillmentChannel: "FBA",
        fbaStock: item.fbaStock ?? target.fbaStock,
        fbaInboundWorking: item.fbaInboundWorking ?? target.fbaInboundWorking,
        fbaInboundShipped: item.fbaInboundShipped ?? target.fbaInboundShipped,
        fbaInboundReceiving: item.fbaInboundReceiving ?? target.fbaInboundReceiving,
        fbaInboundTotal: item.fbaInboundTotal ?? target.fbaInboundTotal,
        inventoryStatus: "Active",
        updatedAt: new Date(),
      })
      .where(eq(listings.id, target.id));
    return { updated: true, id: target.id, asin: item.asin };
  }

  const [created] = await db.insert(listings).values({
    storeId: store.id,
    marketplace: item.marketplace,
    asin: item.asin,
    sku: item.sku || `SKU-${item.asin}`,
    title: item.title,
    category,
    categoryName: item.categoryName || "线香与香道用品",
    imageUrl: item.imageUrl || null,
    price: item.price || "19.99",
    currency: item.currency || (item.marketplace === "US" ? "USD" : item.marketplace === "CA" ? "CAD" : "JPY"),
    fulfillmentChannel: "FBA",
    inventoryStatus: "Active",
    fbaStock: item.fbaStock ?? 100,
    fbaInboundWorking: item.fbaInboundWorking ?? 0,
    fbaInboundShipped: item.fbaInboundShipped ?? 0,
    fbaInboundReceiving: item.fbaInboundReceiving ?? 0,
    fbaInboundTotal: item.fbaInboundTotal ?? 0,
    salesFollowUpStatus: "normal",
    assignedSales: item.assignedSales || "销售组",
  });

  return { created: true, id: created.insertId, asin: item.asin };
}

export function selectTopCoreKeywords(
  candidates: Array<{
    keyword: string;
    searchVolume?: number;
    conversions?: number;
    conversionRate?: number;
    isConvertingAdTerm?: boolean;
  }>,
  minCount: number = 6,
  maxCount: number = 20
) {
  // 核心词打分机制：历史转化权重 50% + 转化率权重 30% + 搜索量权重 20%
  const scored = candidates.map(c => {
    const conv = c.conversions || 0;
    const cvr = c.conversionRate || 0;
    const vol = c.searchVolume || 0;
    const adBonus = c.isConvertingAdTerm ? 20 : 0;
    const score = conv * 5 + cvr * 2 + Math.log10(vol + 1) * 3 + adBonus;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(maxCount, Math.max(minCount, scored.length)));
}

export async function runDailyRankSnapshot(listingId?: number) {
  return {
    success: false,
    snapshotDate: new Date().toISOString().slice(0, 10),
    listingsTracked: 0,
    keywordsUpdated: 0,
    alertCount: 0,
    message: "真实自然排名采集尚未运行；系统已禁用任何随机或模拟排名写入。",
  };
}
