import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { dailyRankSnapshots, InsertUser, keywords, listings, salesLogs, stores, users } from "../drizzle/schema";
import { buildDateWindow, dateKeyInTimeZone } from "../shared/rankTrend";
import { ENV } from "./_core/env";
import { mergeOrderedSubset, type SalesCategory } from "./listingOrganization";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  if (user.name) values.name = user.name;
  if (user.email) values.email = user.email;
  if (user.role) values.role = user.role;
  else if (user.openId === ENV.ownerOpenId) values.role = "admin";
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: values });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getStoreSettings() {
  const db = await getDb();
  if (!db) return null;
  const list = await db.select().from(stores).limit(1);
  if (list.length > 0) return list[0];
  const [created] = await db.insert(stores).values({
    name: "Amazon US & CA Official Store",
    sellerId: "",
    adsProfileUs: "898659032586056",
    adsProfileCa: "673034626677273",
    syncStatus: "idle",
  });
  const res = await db.select().from(stores).where(eq(stores.id, created.insertId)).limit(1);
  return res[0] || null;
}

export async function updateStoreSettings(payload: {
  sellerId?: string;
  spapiRefreshToken?: string;
  adsProfileUs?: string;
  adsProfileCa?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const store = await getStoreSettings();
  if (!store) return null;
  await db.update(stores).set({ ...payload, updatedAt: new Date() }).where(eq(stores.id, store.id));
  const updated = await db.select().from(stores).where(eq(stores.id, store.id)).limit(1);
  return updated[0];
}

export async function getListings(marketplace?: "US" | "CA" | "JP", category?: string, status?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(listings.fulfillmentChannel, "FBA"),
    eq(listings.inventoryStatus, "Active"),
    gt(listings.fbaStock, 0),
  ];
  if (marketplace) conditions.push(eq(listings.marketplace, marketplace));
  if (category && category !== "all") conditions.push(eq(listings.category, category as any));
  if (status && status !== "all") conditions.push(eq(listings.inventoryStatus, status as any));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const listingRows = await db.select().from(listings).where(whereClause).orderBy(desc(listings.updatedAt));
  if (!listingRows.length) return [];
  const keywordRows = await db.select().from(keywords).where(inArray(keywords.listingId, listingRows.map(item => item.id)));
  const statusWeight = { action_needed: 10000, watch: 7000, optimizing: 4000, normal: 0 } as const;
  const enriched = listingRows
    .map(listing => {
      const ownKeywords = keywordRows.filter(keyword => keyword.listingId === listing.id);
      const conversionValue = ownKeywords.reduce((sum, keyword) => sum + (keyword.historicalConversionCount ?? 0), 0);
      const droppedCount = ownKeywords.filter(keyword => (keyword.rankChange ?? 0) < 0).length;
      const stockRisk = (listing.fbaStock ?? 0) <= 30 ? 1200 : (listing.fbaStock ?? 0) <= 60 ? 600 : 0;
      const importanceScore = statusWeight[listing.salesFollowUpStatus] + droppedCount * 500 + stockRisk + Math.min(conversionValue * 10, 3000);
      return { ...listing, importanceScore };
    });
  const hasManualOrder = enriched.some(item => item.manualSortOrder > 0);
  return enriched.sort((a, b) => {
    if (hasManualOrder) {
      const aOrder = a.manualSortOrder > 0 ? a.manualSortOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = b.manualSortOrder > 0 ? b.manualSortOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return b.importanceScore - a.importanceScore || b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export async function deactivateListingsMissingFromSync(
  marketplace: "US" | "CA" | "JP",
  activeKeys: string[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const current = await db.select().from(listings).where(eq(listings.marketplace, marketplace));
  const activeSet = new Set(activeKeys);
  let deactivated = 0;
  for (const item of current) {
    const key = `${item.asin}:${item.sku ?? ""}`;
    if (!activeSet.has(key)) {
      await db
        .update(listings)
        .set({ inventoryStatus: "Inactive", fbaStock: 0, updatedAt: new Date() })
        .where(eq(listings.id, item.id));
      deactivated += 1;
    }
  }
  return deactivated;
}

export async function getListingById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return rows[0] || null;
}

export async function getListingKeywords(listingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(keywords).where(eq(keywords.listingId, listingId)).orderBy(desc(keywords.isCore), desc(keywords.historicalConversionCount));
}

export async function getRankSnapshots(listingId: number) {
  const db = await getDb();
  if (!db) return [];
  const today = dateKeyInTimeZone(new Date(), "Asia/Shanghai");
  const startDate = buildDateWindow(today, 7)[0]!;
  return db
    .select()
    .from(dailyRankSnapshots)
    .where(and(eq(dailyRankSnapshots.listingId, listingId), gte(dailyRankSnapshots.snapshotDate, startDate)))
    .orderBy(dailyRankSnapshots.snapshotDate);
}

export async function addSalesLog(listingId: number, author: string, content: string, actionType: string = "销售跟进", suggestedAction?: string) {
  const db = await getDb();
  if (!db) return null;
  const [created] = await db.insert(salesLogs).values({
    listingId,
    author,
    actionType,
    content,
    suggestedAction: suggestedAction || null,
  });
  return created.insertId;
}

export async function getSalesLogs(listingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(salesLogs).where(eq(salesLogs.listingId, listingId)).orderBy(desc(salesLogs.createdAt));
}

export async function updateListingFollowUp(listingId: number, status: "normal" | "watch" | "action_needed" | "optimizing", notes?: string) {
  const db = await getDb();
  if (!db) return null;
  const payload: any = { salesFollowUpStatus: status, updatedAt: new Date() };
  if (notes !== undefined) payload.notes = notes;
  await db.update(listings).set(payload).where(eq(listings.id, listingId));
  return getListingById(listingId);
}

export async function reorderListings(orderedIds: number[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const current = await getListings();
  const mergedIds = mergeOrderedSubset(current.map(item => item.id), orderedIds);
  await db.transaction(async tx => {
    for (let index = 0; index < mergedIds.length; index += 1) {
      const id = mergedIds[index]!;
      await tx
        .update(listings)
        .set({ manualSortOrder: (index + 1) * 10 })
        .where(eq(listings.id, id));
    }
  });
  return { updated: mergedIds.length, orderedIds: mergedIds };
}

export async function updateListingOrganization(
  listingId: number,
  salesCategory: SalesCategory,
  customCategoryLabel?: string,
  salesNotes?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const normalizedCustomLabel = salesCategory === "custom" ? customCategoryLabel?.trim() || null : null;
  const normalizedNotes = salesNotes?.trim() || null;
  await db
    .update(listings)
    .set({
      salesCategory,
      customCategoryLabel: normalizedCustomLabel,
      salesNotes: normalizedNotes,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId));
  return getListingById(listingId);
}

export async function bulkUpdateListingOrganization(input: {
  listingIds: number[];
  salesCategory?: SalesCategory;
  customCategoryLabel?: string;
  notesAction: "keep" | "append" | "replace" | "clear";
  salesNotes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const current = await db.select().from(listings).where(inArray(listings.id, input.listingIds));
  if (current.length !== input.listingIds.length) throw new Error("部分 Listing 不存在，批量修改已取消");
  const now = new Date();
  await db.transaction(async tx => {
    for (const item of current) {
      const payload: Record<string, unknown> = { updatedAt: now };
      if (input.salesCategory) {
        payload.salesCategory = input.salesCategory;
        payload.customCategoryLabel = input.salesCategory === "custom" ? input.customCategoryLabel?.trim() || null : null;
      }
      if (input.notesAction === "clear") payload.salesNotes = null;
      if (input.notesAction === "replace") payload.salesNotes = input.salesNotes?.trim() || null;
      if (input.notesAction === "append") {
        const addition = input.salesNotes?.trim() || "";
        payload.salesNotes = item.salesNotes?.trim() ? `${item.salesNotes.trim()}\n${addition}` : addition;
      }
      await tx.update(listings).set(payload).where(eq(listings.id, item.id));
      await tx.insert(salesLogs).values({
        listingId: item.id,
        author: "销售团队",
        actionType: "批量分类与备注",
        content: `批量处理：${input.salesCategory ? `分类=${input.salesCategory}` : "分类保持不变"}；备注操作=${input.notesAction}`,
      });
    }
  });
  return { updated: current.length };
}

export type ProductReviewMetricInput = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  rating: number | null;
  reviewCount: number | null;
  source: string;
};

export async function applyProductReviewMetrics(metrics: ProductReviewMetricInput[], observedAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const liveListings = await getListings();
  const expectedKeys = new Set(liveListings.map(item => `${item.marketplace}:${item.asin}`));
  const actualKeys = metrics.map(item => `${item.marketplace}:${item.asin}`);
  if (actualKeys.length !== expectedKeys.size || new Set(actualKeys).size !== actualKeys.length) {
    throw new Error(`Review metric batch mismatch: expected ${expectedKeys.size}, received ${actualKeys.length}`);
  }
  const missing = Array.from(expectedKeys).filter(key => !actualKeys.includes(key));
  const extra = actualKeys.filter(key => !expectedKeys.has(key));
  if (missing.length || extra.length) throw new Error(`Review metric keys mismatch: missing=${missing.length}, extra=${extra.length}`);
  await db.transaction(async tx => {
    for (const metric of metrics) {
      await tx
        .update(listings)
        .set({
          reviewRating: metric.rating === null ? null : metric.rating.toFixed(2),
          reviewCount: metric.reviewCount,
          reviewMetricsSource: metric.source,
          reviewMetricsUpdatedAt: observedAt,
        })
        .where(and(eq(listings.marketplace, metric.marketplace), eq(listings.asin, metric.asin)));
    }
  });
  return { updated: metrics.length };
}

export async function getDashboardOverview(marketplace?: "US" | "CA" | "JP") {
  const db = await getDb();
  const empty = {
    totalListings: 0,
    incenseSticksCount: 0,
    burnerCount: 0,
    holderCount: 0,
    totalKeywordsTracked: 0,
    top10Count: 0,
    top50Count: 0,
    droppedCount: 0,
    risenCount: 0,
  };
  if (!db) return empty;

  const liveConditions = [
    eq(listings.fulfillmentChannel, "FBA"),
    eq(listings.inventoryStatus, "Active"),
    gt(listings.fbaStock, 0),
  ];
  if (marketplace) liveConditions.push(eq(listings.marketplace, marketplace));
  const allListings = await db.select().from(listings).where(and(...liveConditions));
  const listingIds = allListings.map(l => l.id);
  if (listingIds.length === 0) return empty;

  const allKeywords = await db.select().from(keywords).where(inArray(keywords.listingId, listingIds));
  let top10 = 0;
  let top50 = 0;
  let risen = 0;
  let dropped = 0;
  for (const kw of allKeywords) {
    const curr = kw.currentRank ?? 0;
    const change = kw.rankChange ?? 0;
    if (curr > 0 && curr <= 10) top10++;
    if (curr > 0 && curr <= 50) top50++;
    if (change > 0) risen++;
    if (change < 0) dropped++;
  }

  return {
    totalListings: allListings.length,
    incenseSticksCount: allListings.filter(l => l.category === "incense_sticks").length,
    burnerCount: allListings.filter(l => l.category === "incense_burner").length,
    holderCount: allListings.filter(l => l.category === "incense_holder").length,
    totalKeywordsTracked: allKeywords.length,
    top10Count: top10,
    top50Count: top50,
    droppedCount: dropped,
    risenCount: risen,
  };
}

export async function getRankTrackingTargets() {
  const db = await getDb();
  if (!db) return [];
  const liveListings = await db
    .select()
    .from(listings)
    .where(and(eq(listings.fulfillmentChannel, "FBA"), eq(listings.inventoryStatus, "Active")));
  const result = [];
  for (const listing of liveListings.filter(item => (item.fbaStock ?? 0) > 0)) {
    const listingKeywords = await db
      .select({ keyword: keywords.keyword })
      .from(keywords)
      .where(and(eq(keywords.listingId, listing.id), eq(keywords.isCore, true)));
    result.push({
      marketplace: listing.marketplace,
      asin: listing.asin,
      sku: listing.sku,
      keywords: listingKeywords.map(row => row.keyword),
    });
  }
  return result;
}

export type RankSnapshotInput = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  keyword: string;
  rank: number;
  page?: number;
  pcAdRank?: number | null;
  pcSbvRank?: number | null;
};

export type PcAdvertisingRankInput = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  keyword: string;
  pcAdRank: number;
  pcSbvRank: number;
  source: "dataforseo_amazon_pc_serp";
};

export type CprEstimateInput = {
  marketplace: "US" | "CA" | "JP";
  asin: string;
  keyword: string;
  cprEstimate: number | null;
  monthlySalesAverage: number | null;
  sampleCount: number;
  source: "sorftime_keyword_search_results" | "dataforseo_amazon_pc_serp";
};

const rankTargetKey = (marketplace: string, asin: string, keyword: string) =>
  `${marketplace}:${asin.trim().toUpperCase()}:${keyword.trim().normalize("NFKC").toLowerCase()}`;

/**
 * Stores CPR proxies derived from real organic SERP results. A null CPR is a valid,
 * explicitly auditable result when the provider returned fewer than five usable sales samples.
 */
export async function applyCprEstimates(metrics: CprEstimateInput[], observedAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const liveListings = await db
    .select()
    .from(listings)
    .where(and(eq(listings.fulfillmentChannel, "FBA"), eq(listings.inventoryStatus, "Active"), gt(listings.fbaStock, 0)));
  const listingIds = liveListings.map(item => item.id);
  const coreKeywords = listingIds.length
    ? await db.select().from(keywords).where(and(inArray(keywords.listingId, listingIds), eq(keywords.isCore, true)))
    : [];
  const listingById = new Map(liveListings.map(item => [item.id, item] as const));
  const expected = new Map(coreKeywords.map(keyword => {
    const listing = listingById.get(keyword.listingId);
    if (!listing) throw new Error(`Missing Listing for CPR keyword ${keyword.id}`);
    return [rankTargetKey(listing.marketplace, listing.asin, keyword.keyword), keyword] as const;
  }));
  const keys = metrics.map(metric => rankTargetKey(metric.marketplace, metric.asin, metric.keyword));
  if (keys.length !== expected.size || new Set(keys).size !== keys.length) {
    throw new Error(`CPR batch mismatch: expected ${expected.size}, received ${keys.length}, unique=${new Set(keys).size}`);
  }
  const missing = Array.from(expected.keys()).filter(key => !keys.includes(key));
  const extra = keys.filter(key => !expected.has(key));
  if (missing.length || extra.length) throw new Error(`CPR target mismatch: missing=${missing.length}, extra=${extra.length}`);

  const prepared = metrics.map(metric => {
    const keyword = expected.get(rankTargetKey(metric.marketplace, metric.asin, metric.keyword));
    if (!keyword) throw new Error(`Unknown CPR target ${metric.marketplace}/${metric.asin}/${metric.keyword}`);
    const sampleCount = Math.trunc(metric.sampleCount);
    if (sampleCount < 0 || sampleCount > 10) throw new Error(`Invalid CPR sample count for ${metric.keyword}`);
    const cprEstimate = metric.cprEstimate === null ? null : Math.trunc(metric.cprEstimate);
    const monthlySalesAverage = metric.monthlySalesAverage === null ? null : Math.trunc(metric.monthlySalesAverage);
    if (cprEstimate !== null && (cprEstimate < 1 || monthlySalesAverage === null || monthlySalesAverage < 0 || sampleCount < 5)) {
      throw new Error(`Invalid CPR estimate for ${metric.keyword}`);
    }
    if (cprEstimate === null && monthlySalesAverage !== null) throw new Error(`Partial CPR evidence for ${metric.keyword}`);
    return { keyword, cprEstimate, monthlySalesAverage, sampleCount, source: metric.source };
  });

  await db.transaction(async tx => {
    for (const item of prepared) {
      await tx.update(keywords).set({
        cprEstimate: item.cprEstimate,
        cprMonthlySalesAverage: item.monthlySalesAverage,
        cprSampleCount: item.sampleCount,
        cprSource: item.source,
        cprUpdatedAt: observedAt,
        updatedAt: observedAt,
      }).where(eq(keywords.id, item.keyword.id));
    }
  });
  return {
    expected: expected.size,
    updated: prepared.length,
    calculated: prepared.filter(item => item.cprEstimate !== null).length,
    insufficientEvidence: prepared.filter(item => item.cprEstimate === null).length,
  };
}

/**
 * Updates desktop advertising ranks without touching the already-collected natural rank,
 * previous natural rank, daily natural change, or historical best natural rank.
 */
export async function applyPcAdvertisingRanks(snapshotDate: string, positions: PcAdvertisingRankInput[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const liveListings = await db
    .select()
    .from(listings)
    .where(and(eq(listings.fulfillmentChannel, "FBA"), eq(listings.inventoryStatus, "Active"), gt(listings.fbaStock, 0)));
  const listingById = new Map(liveListings.map(item => [item.id, item] as const));
  const listingIds = liveListings.map(item => item.id);
  const coreKeywords = listingIds.length
    ? await db.select().from(keywords).where(and(inArray(keywords.listingId, listingIds), eq(keywords.isCore, true)))
    : [];
  const expectedByKey = new Map(
    coreKeywords.map(keyword => {
      const listing = listingById.get(keyword.listingId);
      if (!listing) throw new Error(`Missing listing for keyword ${keyword.id}`);
      return [rankTargetKey(listing.marketplace, listing.asin, keyword.keyword), { listing, keyword }] as const;
    })
  );
  if (!expectedByKey.size) throw new Error("No active FBA core-keyword targets available for PC advertising rank ingestion");

  const actualKeys = positions.map(item => rankTargetKey(item.marketplace, item.asin, item.keyword));
  if (actualKeys.length !== expectedByKey.size || new Set(actualKeys).size !== actualKeys.length) {
    throw new Error(`PC advertising batch mismatch: expected ${expectedByKey.size}, received ${actualKeys.length}, unique=${new Set(actualKeys).size}`);
  }
  const missing = Array.from(expectedByKey.keys()).filter(key => !actualKeys.includes(key));
  const extra = actualKeys.filter(key => !expectedByKey.has(key));
  if (missing.length || extra.length) {
    throw new Error(`PC advertising target mismatch: missing=${missing.length}, extra=${extra.length}`);
  }

  const prepared = positions.map(position => {
    const target = expectedByKey.get(rankTargetKey(position.marketplace, position.asin, position.keyword));
    if (!target) throw new Error(`Unknown PC advertising target ${position.marketplace}/${position.asin}/${position.keyword}`);
    const pcAdRank = Math.trunc(position.pcAdRank);
    const pcSbvRank = Math.trunc(position.pcSbvRank);
    if (pcAdRank < 1 || pcAdRank > 999 || pcSbvRank < 1 || pcSbvRank > 999) {
      throw new Error(`Invalid PC advertising rank ${position.marketplace}/${position.asin}/${position.keyword}`);
    }
    return { ...target, pcAdRank, pcSbvRank };
  });

  const keywordIds = prepared.map(item => item.keyword.id);
  const snapshotRows = await db
    .select({ keywordId: dailyRankSnapshots.keywordId })
    .from(dailyRankSnapshots)
    .where(and(eq(dailyRankSnapshots.snapshotDate, snapshotDate), inArray(dailyRankSnapshots.keywordId, keywordIds)));
  if (snapshotRows.length !== keywordIds.length) {
    throw new Error(`Natural-rank snapshot prerequisite missing: expected ${keywordIds.length}, found ${snapshotRows.length} for ${snapshotDate}`);
  }

  await db.transaction(async tx => {
    for (const item of prepared) {
      await tx
        .update(keywords)
        .set({ pcAdRank: item.pcAdRank, pcSbvRank: item.pcSbvRank, updatedAt: new Date() })
        .where(eq(keywords.id, item.keyword.id));
      await tx
        .update(dailyRankSnapshots)
        .set({ pcAdRank: item.pcAdRank, pcSbvRank: item.pcSbvRank })
        .where(and(eq(dailyRankSnapshots.keywordId, item.keyword.id), eq(dailyRankSnapshots.snapshotDate, snapshotDate)));
    }
  });

  return {
    snapshotDate,
    expected: expectedByKey.size,
    updated: prepared.length,
    pcAdFound: prepared.filter(item => item.pcAdRank < 999).length,
    pcSbvFound: prepared.filter(item => item.pcSbvRank < 999).length,
    neitherFound: prepared.filter(item => item.pcAdRank === 999 && item.pcSbvRank === 999).length,
  };
}

export async function applyRealRankSnapshots(snapshotDate: string, snapshots: RankSnapshotInput[]) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const liveListings = await db.select().from(listings);
  const relevantIds = liveListings.map(item => item.id);
  const liveKeywords = relevantIds.length
    ? await db.select().from(keywords).where(inArray(keywords.listingId, relevantIds))
    : [];
  const listingByKey = new Map(liveListings.map(item => [`${item.marketplace}:${item.asin}`, item]));
  const keywordByKey = new Map(
    liveKeywords.map(item => {
      const listing = liveListings.find(row => row.id === item.listingId)!;
      return [`${listing.marketplace}:${listing.asin}:${item.keyword.trim().toLowerCase()}`, item] as const;
    })
  );

  const prepared = snapshots.map(item => {
    const listing = listingByKey.get(`${item.marketplace}:${item.asin}`);
    if (!listing) throw new Error(`Unknown listing ${item.marketplace}/${item.asin}`);
    const keyword = keywordByKey.get(`${item.marketplace}:${item.asin}:${item.keyword.trim().toLowerCase()}`);
    if (!keyword) throw new Error(`Unknown tracked keyword ${item.marketplace}/${item.asin}/${item.keyword}`);
    const rank = Math.max(1, Math.min(999, Math.trunc(item.rank)));
    const oldRank = keyword.currentRank && keyword.currentRank > 0 ? keyword.currentRank : 0;
    const change = oldRank > 0 ? oldRank - rank : 0;
    const oldBest = keyword.bestRank ?? 0;
    const bestRank = rank < 999 ? (oldBest > 0 ? Math.min(oldBest, rank) : rank) : oldBest;
    const page = item.page ? Math.max(1, Math.min(4, Math.trunc(item.page))) : rank === 999 ? 4 : Math.ceil(rank / 48);
    const pcAdRank = item.pcAdRank === undefined ? null : item.pcAdRank === null ? null : Math.max(1, Math.min(999, Math.trunc(item.pcAdRank)));
    const pcSbvRank = item.pcSbvRank === undefined ? null : item.pcSbvRank === null ? null : Math.max(1, Math.min(999, Math.trunc(item.pcSbvRank)));
    return { listing, keyword, rank, oldRank, change, bestRank, page, pcAdRank, pcSbvRank };
  });

  const snapshotKeywordIds = Array.from(new Set(prepared.map(item => item.keyword.id)));
  if (snapshotKeywordIds.length) {
    await db
      .delete(dailyRankSnapshots)
      .where(and(eq(dailyRankSnapshots.snapshotDate, snapshotDate), inArray(dailyRankSnapshots.keywordId, snapshotKeywordIds)));
  }

  const alertMap = new Map<number, Array<{ keyword: string; drop: number }>>();
  for (const item of prepared) {
    await db
      .update(keywords)
      .set({
        previousRank: item.oldRank,
        currentRank: item.rank,
        rankChange: item.change,
        bestRank: item.bestRank,
        pageNumber: item.page,
        pcAdRank: item.pcAdRank,
        pcSbvRank: item.pcSbvRank,
        updatedAt: new Date(),
      })
      .where(eq(keywords.id, item.keyword.id));
    await db.insert(dailyRankSnapshots).values({
      keywordId: item.keyword.id,
      listingId: item.listing.id,
      marketplace: item.listing.marketplace,
      snapshotDate,
      rank: item.rank,
      page: item.page,
      pcAdRank: item.pcAdRank,
      pcSbvRank: item.pcSbvRank,
      changeFromYesterday: item.change,
      isTop10: item.rank <= 10,
      isTop50: item.rank <= 50,
    });
    if (item.change <= -3) {
      const current = alertMap.get(item.listing.id) ?? [];
      current.push({ keyword: item.keyword.keyword, drop: Math.abs(item.change) });
      alertMap.set(item.listing.id, current);
    }
  }

  for (const [listingId, alerts] of Array.from(alertMap.entries())) {
    await db.update(listings).set({ salesFollowUpStatus: "action_needed", updatedAt: new Date() }).where(eq(listings.id, listingId));
    await db.insert(salesLogs).values({
      listingId,
      author: "真实自然位监控",
      actionType: "排名下滑告警",
      content: `${snapshotDate} 检测到 ${alerts.length} 个核心词自然位下滑至少 3 位：${alerts.map((item: { keyword: string; drop: number }) => `${item.keyword} (↓${item.drop})`).join("、")}`,
      suggestedAction: "建议销售检查库存、价格、广告防守和竞品变化；排名 999 表示未进入前三页。",
    });
  }

  return {
    snapshotDate,
    received: snapshots.length,
    updated: prepared.length,
    alerts: Array.from(alertMap.values()).reduce((sum, rows) => sum + rows.length, 0),
  };
}
