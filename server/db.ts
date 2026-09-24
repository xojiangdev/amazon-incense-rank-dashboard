import { and, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { cprSyncStates, dailyRankSnapshots, InsertUser, keywords, listings, salesLogs, stores, users } from "../drizzle/schema";
import { buildDateWindow, dateKeyInTimeZone } from "../shared/rankTrend";
import { githubCprSourceVersion, isNewerGitHubCprVersion, type GitHubCprDocument } from "../shared/githubCpr";
import { isManualCategoryException } from "../shared/manualCategoryExceptions";
import { ENV } from "./_core/env";
import { mergeOrderedSubset, type SalesCategory } from "./listingOrganization";

let _db: ReturnType<typeof drizzle> | null = null;

const normalizeCprKeyword = (keyword: string) => keyword.trim().normalize("NFKC").toLowerCase();

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

export type GitHubCprSyncInput = {
  sourceKey: string;
  sourceUrl: string;
  remoteSha: string;
  remoteUpdatedAt: Date;
  document: GitHubCprDocument;
  /** Local recovery only: reconcile the current authoritative document even when its SHA is unchanged. */
  force?: boolean;
};

/**
 * Repository CPR is intentionally keyword-wide: all active core-keyword rows
 * with the same normalized phrase receive the same repository record. Unlike
 * rank collection, it neither reads nor changes organic, ad, SBV, or snapshot
 * fields. A non-new source never writes rows.
 */
export type AdOrderTerm = { asin: string; keyword: string; adPurchases: number };

/**
 * 关键词广告单写入(仅关键词定向广告,来自广告搜索词报表)。
 * 报表不含的词=未投放→清空,与权威文档同语义。
 */
export async function applyAdOrders(marketplace: "US" | "CA" | "JP", terms: AdOrderTerm[], observedAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // 部署后首跑自动补列(MySQL 1060 duplicate column 时忽略)
  await db.execute(`ALTER TABLE keywords ADD COLUMN adPurchases INT NULL`).catch(() => {});
  const activeListings = await db.select().from(listings).where(and(
    eq(listings.marketplace, marketplace),
    eq(listings.fulfillmentChannel, "FBA"),
    eq(listings.inventoryStatus, "Active")
  ));
  const listingByAsin = new Map(activeListings.map(l => [l.asin, l] as const));
  const activeIds = new Set(activeListings.map(l => l.id));
  const coreKeywords = await db.select().from(keywords).where(eq(keywords.isCore, true));
  const kwByKey = new Map(coreKeywords.map(k => [`${k.listingId}:${normalizeCprKeyword(k.keyword)}`, k] as const));
  let updated = 0;
  let cleared = 0;
  await db.transaction(async tx => {
    const matched = new Set<string>();
    for (const t of terms) {
      const listing = listingByAsin.get(t.asin.trim().toUpperCase());
      if (!listing) continue;
      const key = `${listing.id}:${normalizeCprKeyword(t.keyword)}`;
      const kw = kwByKey.get(key);
      if (!kw) continue;
      matched.add(key);
      await tx.update(keywords).set({ adPurchases: t.adPurchases, updatedAt: observedAt }).where(eq(keywords.id, kw.id));
      updated += 1;
    }
    for (const kw of coreKeywords) {
      if (!activeIds.has(kw.listingId)) continue;
      const key = `${kw.listingId}:${normalizeCprKeyword(kw.keyword)}`;
      if (!matched.has(key) && kw.adPurchases !== null && kw.adPurchases !== undefined) {
        await tx.update(keywords).set({ adPurchases: null, updatedAt: observedAt }).where(eq(keywords.id, kw.id));
        cleared += 1;
      }
    }
  });
  return { received: terms.length, updated, cleared };
}

export async function applyGitHubCprDocument(input: GitHubCprSyncInput, observedAt = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const current = (await db.select().from(cprSyncStates).where(eq(cprSyncStates.sourceKey, input.sourceKey)).limit(1))[0];
  if (!input.force && !isNewerGitHubCprVersion(input.remoteSha, input.remoteUpdatedAt, current)) {
    await db.insert(cprSyncStates).values({
      sourceKey: input.sourceKey,
      sourceUrl: input.sourceUrl,
      remoteSha: current?.remoteSha ?? null,
      remoteUpdatedAt: current?.remoteUpdatedAt ?? null,
      sourceGeneratedAt: current?.sourceGeneratedAt ?? null,
      calibration: current?.calibration ?? null,
      sourceRecordCount: current?.sourceRecordCount ?? 0,
      matchedKeywordCount: current?.matchedKeywordCount ?? 0,
      updatedKeywordCount: current?.updatedKeywordCount ?? 0,
      lastCheckedAt: observedAt,
      lastAppliedAt: current?.lastAppliedAt ?? null,
      lastStatus: "not_newer",
      lastError: null,
      createdAt: current?.createdAt ?? observedAt,
      updatedAt: observedAt,
    }).onDuplicateKeyUpdate({
      set: { lastCheckedAt: observedAt, lastStatus: "not_newer", lastError: null, updatedAt: observedAt },
    });
    return { status: "not_newer" as const, updated: 0, matched: 0, cleared: 0, sourceRecords: input.document.records.length };
  }

  const recordByKeyword = new Map(input.document.records.map(record => [record.normalizedKeyword, record] as const));
  const activeListings = await db.select().from(listings).where(and(
    eq(listings.fulfillmentChannel, "FBA"),
    eq(listings.inventoryStatus, "Active"),
    gt(listings.fbaStock, 0)
  ));
  const activeListingIds = activeListings.map(listing => listing.id);
  const activeCoreKeywords = activeListingIds.length
    ? await db.select().from(keywords).where(and(inArray(keywords.listingId, activeListingIds), eq(keywords.isCore, true)))
    : [];
  const matched = activeCoreKeywords.flatMap(keyword => {
    const record = recordByKeyword.get(normalizeCprKeyword(keyword.keyword));
    return record ? [{ keyword, record }] : [];
  });

  // 权威文档不含的关键词 → 清空既有 CPR，防止已移除的词残留旧值。
  // 已经为空的词不做无效写入，也不刷新其 CPR 时间戳。
  const clearedKeywordIds = activeCoreKeywords
    .filter(keyword => !recordByKeyword.has(normalizeCprKeyword(keyword.keyword)))
    .filter(keyword => keyword.cprEstimate !== null || keyword.cprMonthlySalesAverage !== null || keyword.cprSampleCount !== null || keyword.cprSource !== null)
    .map(keyword => keyword.id);
  const updatedCount = matched.length + clearedKeywordIds.length;
  const appliedStatus = matched.length > 0 || clearedKeywordIds.length > 0 ? "applied" : "no_match";
  await db.transaction(async tx => {
    for (const item of matched) {
      await tx.update(keywords).set({
        cprEstimate: item.record.cpr,
        cprMonthlySalesAverage: item.record.avgMonthlySales,
        cprSampleCount: item.record.samples,
        cprSource: githubCprSourceVersion(input.remoteSha),
        cprUpdatedAt: observedAt,
        updatedAt: observedAt,
      }).where(eq(keywords.id, item.keyword.id));
    }
    if (clearedKeywordIds.length) {
      await tx.update(keywords).set({
        cprEstimate: null,
        cprMonthlySalesAverage: null,
        cprSampleCount: null,
        cprSource: null,
        cprUpdatedAt: observedAt,
        updatedAt: observedAt,
      }).where(inArray(keywords.id, clearedKeywordIds));
    }
    await tx.insert(cprSyncStates).values({
      sourceKey: input.sourceKey,
      sourceUrl: input.sourceUrl,
      remoteSha: input.remoteSha,
      remoteUpdatedAt: input.remoteUpdatedAt,
      sourceGeneratedAt: input.document.generatedAt,
      calibration: input.document.calibration,
      sourceRecordCount: input.document.records.length,
      matchedKeywordCount: matched.length,
      updatedKeywordCount: updatedCount,
      lastCheckedAt: observedAt,
      lastAppliedAt: observedAt,
      lastStatus: appliedStatus,
      lastError: null,
      createdAt: current?.createdAt ?? observedAt,
      updatedAt: observedAt,
    }).onDuplicateKeyUpdate({
      set: {
        sourceUrl: input.sourceUrl,
        remoteSha: input.remoteSha,
        remoteUpdatedAt: input.remoteUpdatedAt,
        sourceGeneratedAt: input.document.generatedAt,
        calibration: input.document.calibration,
        sourceRecordCount: input.document.records.length,
        matchedKeywordCount: matched.length,
        updatedKeywordCount: updatedCount,
        lastCheckedAt: observedAt,
        lastAppliedAt: observedAt,
        lastStatus: appliedStatus,
        lastError: null,
        updatedAt: observedAt,
      },
    });
  });

  return {
    status: appliedStatus,
    updated: updatedCount,
    matched: matched.length,
    cleared: clearedKeywordIds.length,
    sourceRecords: input.document.records.length,
    sourceGeneratedAt: input.document.generatedAt.toISOString(),
  };
}

export async function recordGitHubCprSyncFailure(input: { sourceKey: string; sourceUrl: string; error: string; status?: "error" | "file_not_found"; observedAt?: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const observedAt = input.observedAt ?? new Date();
  const current = (await db.select().from(cprSyncStates).where(eq(cprSyncStates.sourceKey, input.sourceKey)).limit(1))[0];
  await db.insert(cprSyncStates).values({
    sourceKey: input.sourceKey,
    sourceUrl: input.sourceUrl,
    remoteSha: current?.remoteSha ?? null,
    remoteUpdatedAt: current?.remoteUpdatedAt ?? null,
    sourceGeneratedAt: current?.sourceGeneratedAt ?? null,
    calibration: current?.calibration ?? null,
    sourceRecordCount: current?.sourceRecordCount ?? 0,
    matchedKeywordCount: current?.matchedKeywordCount ?? 0,
    updatedKeywordCount: current?.updatedKeywordCount ?? 0,
    lastCheckedAt: observedAt,
    lastAppliedAt: current?.lastAppliedAt ?? null,
    lastStatus: input.status ?? "error",
    lastError: input.error.slice(0, 4000),
    createdAt: current?.createdAt ?? observedAt,
    updatedAt: observedAt,
  }).onDuplicateKeyUpdate({
    set: { sourceUrl: input.sourceUrl, lastCheckedAt: observedAt, lastStatus: input.status ?? "error", lastError: input.error.slice(0, 4000), updatedAt: observedAt },
  });
}

export async function getGitHubCprSyncState(sourceKey: string) {
  const db = await getDb();
  if (!db) return null;
  return (await db.select().from(cprSyncStates).where(eq(cprSyncStates.sourceKey, sourceKey)).limit(1))[0] ?? null;
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
  const keywordRows = await db.select().from(keywords).where(and(inArray(keywords.listingId, listingRows.map(item => item.id)), eq(keywords.isCore, true)));
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
    // Explicit, user-approved manual category exceptions are not represented
    // in the incense-only automatic candidate file. Do not deactivate them
    // merely because the automatic collector intentionally filtered them out.
    if (isManualCategoryException(item.marketplace, item.asin)) continue;
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

export type MarketplaceCode = "US" | "CA" | "JP";
export type TargetIncenseCategory = "incense_sticks" | "incense_burner" | "incense_holder";

export type FbaStockCandidateInput = {
  marketplace: MarketplaceCode;
  asin: string;
  sku: string;
  title: string;
  category: TargetIncenseCategory;
  categoryName: string;
  imageUrl: string;
  price: string;
  currency: string;
  fbaStock: number;
  fbaInboundWorking: number;
  fbaInboundShipped: number;
  fbaInboundReceiving: number;
  fbaInboundTotal: number;
  fulfillmentChannel: "FBA";
  listingStatus: "Active";
  sourceReportId: string;
};

export type FbaStockSnapshotInput = {
  marketplace: MarketplaceCode;
  sourceRowCount: number;
  candidates: FbaStockCandidateInput[];
};

const normalizeIngestAsin = (asin: string) => asin.trim().toUpperCase();
const normalizeIngestKeyword = (keyword: string) => keyword.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

function normalizeIngestPrice(raw: string): string {
  const match = String(raw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) throw new Error(`Invalid listing price: ${raw}`);
  return match[0]!;
}

/**
 * Reconciles complete, source-audited FBA listing snapshots. This deliberately
 * touches only Listing inventory/catalog fields: no keyword, rank snapshot,
 * desktop-ad, SBV, or CPR field is read or changed.
 */
export async function applyFbaStockSnapshots(snapshots: FbaStockSnapshotInput[], observedAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (!snapshots.length) throw new Error("At least one complete marketplace FBA snapshot is required");

  const snapshotMarkets = snapshots.map(snapshot => snapshot.marketplace);
  if (new Set(snapshotMarkets).size !== snapshotMarkets.length) {
    throw new Error("FBA snapshot contains duplicate marketplace batches");
  }
  if (!snapshots.some(snapshot => (snapshot.marketplace === "US" || snapshot.marketplace === "CA") && snapshot.candidates.length > 0)) {
    throw new Error("FBA sync requires at least one retained US or CA candidate; zero-candidate North America batches are rejected");
  }

  const store = await getStoreSettings();
  if (!store) throw new Error("Store settings unavailable");
  const prepared = snapshots.map(snapshot => {
    if (snapshot.sourceRowCount < snapshot.candidates.length) {
      throw new Error(`${snapshot.marketplace} sourceRowCount is lower than retained FBA candidate count`);
    }
    const keys = snapshot.candidates.map(candidate => `${candidate.marketplace}:${normalizeIngestAsin(candidate.asin)}:${candidate.sku.trim()}`);
    if (new Set(keys).size !== keys.length) throw new Error(`${snapshot.marketplace} FBA snapshot has duplicate marketplace/ASIN/SKU records`);
    return {
      ...snapshot,
      candidates: snapshot.candidates.map(candidate => {
        if (candidate.marketplace !== snapshot.marketplace) throw new Error(`Candidate marketplace does not match ${snapshot.marketplace} batch`);
        if (candidate.fulfillmentChannel !== "FBA" || candidate.listingStatus !== "Active" || candidate.fbaStock <= 0) {
          throw new Error(`FBA candidate violates FBA/Active/positive-stock contract: ${candidate.marketplace}/${candidate.asin}`);
        }
        const inboundTotal = candidate.fbaInboundWorking + candidate.fbaInboundShipped + candidate.fbaInboundReceiving;
        if (candidate.fbaInboundTotal !== inboundTotal) {
          throw new Error(`Inbound total mismatch for ${candidate.marketplace}/${candidate.asin}: expected ${inboundTotal}, received ${candidate.fbaInboundTotal}`);
        }
        return {
          ...candidate,
          asin: normalizeIngestAsin(candidate.asin),
          sku: candidate.sku.trim(),
          title: candidate.title.trim(),
          categoryName: candidate.categoryName.trim(),
          imageUrl: candidate.imageUrl.trim(),
          price: normalizeIngestPrice(candidate.price),
          currency: candidate.currency.trim().toUpperCase(),
        };
      }),
    };
  });

  const result = {
    observedAt: observedAt.toISOString(),
    created: 0,
    updated: 0,
    deactivated: 0,
    retained: 0,
    marketplaces: [] as Array<{ marketplace: MarketplaceCode; candidates: number; created: number; updated: number; deactivated: number }>,
  };

  await db.transaction(async tx => {
    for (const snapshot of prepared) {
      const current = await tx.select().from(listings).where(eq(listings.marketplace, snapshot.marketplace));
      const currentByAsin = new Map<string, (typeof current)[number]>();
      for (const listing of current) {
        const key = normalizeIngestAsin(listing.asin);
        if (currentByAsin.has(key)) throw new Error(`Existing duplicate listing records for ${snapshot.marketplace}/${key}`);
        currentByAsin.set(key, listing);
      }

      let created = 0;
      let updated = 0;
      const activeKeys = new Set<string>();
      for (const candidate of snapshot.candidates) {
        const activeKey = `${candidate.asin}:${candidate.sku}`;
        activeKeys.add(activeKey);
        const existing = currentByAsin.get(candidate.asin);
        const listingPayload = {
          sku: candidate.sku,
          title: candidate.title,
          category: candidate.category,
          categoryName: candidate.categoryName,
          imageUrl: candidate.imageUrl || null,
          price: candidate.price,
          currency: candidate.currency,
          fulfillmentChannel: "FBA" as const,
          inventoryStatus: "Active" as const,
          fbaStock: candidate.fbaStock,
          fbaInboundWorking: candidate.fbaInboundWorking,
          fbaInboundShipped: candidate.fbaInboundShipped,
          fbaInboundReceiving: candidate.fbaInboundReceiving,
          fbaInboundTotal: candidate.fbaInboundTotal,
          updatedAt: observedAt,
        };
        if (existing) {
          await tx.update(listings).set(listingPayload).where(eq(listings.id, existing.id));
          updated += 1;
        } else {
          await tx.insert(listings).values({
            storeId: store.id,
            marketplace: candidate.marketplace,
            asin: candidate.asin,
            ...listingPayload,
            salesFollowUpStatus: "normal",
            assignedSales: "销售组",
            createdAt: observedAt,
          });
          created += 1;
        }
      }

      let deactivated = 0;
      for (const listing of current) {
        if (isManualCategoryException(listing.marketplace, listing.asin)) continue;
        const activeKey = `${normalizeIngestAsin(listing.asin)}:${listing.sku ?? ""}`;
        if (!activeKeys.has(activeKey)) {
          await tx.update(listings).set({ inventoryStatus: "Inactive", fbaStock: 0, updatedAt: observedAt }).where(eq(listings.id, listing.id));
          deactivated += 1;
        }
      }
      result.created += created;
      result.updated += updated;
      result.deactivated += deactivated;
      result.retained += snapshot.candidates.length;
      result.marketplaces.push({ marketplace: snapshot.marketplace, candidates: snapshot.candidates.length, created, updated, deactivated });
    }
  });
  return result;
}

export type SqpSelectionBasis = "sqp_purchase" | "sqp_cart" | "sqp_click" | "title_fallback";
export type SqpKeywordSelectionInput = {
  marketplace: MarketplaceCode;
  asin: string;
  searchQuery: string;
  searchQueryScore: number;
  searchQueryVolume: number;
  asinImpressionCount: number;
  asinClickCount: number;
  asinCartAddCount: number;
  asinPurchaseCount: number;
  asinConversionRate: number;
  asinPurchaseShare: number;
  startDate: string;
  endDate: string;
  selectionBasis: SqpSelectionBasis;
};

export type SqpKeywordListingInput = {
  marketplace: MarketplaceCode;
  asin: string;
  terms: SqpKeywordSelectionInput[];
};

function assertSqpSelectionEvidence(term: SqpKeywordSelectionInput) {
  const metrics = [
    term.searchQueryScore,
    term.searchQueryVolume,
    term.asinImpressionCount,
    term.asinClickCount,
    term.asinCartAddCount,
    term.asinPurchaseCount,
    term.asinConversionRate,
    term.asinPurchaseShare,
  ];
  if (metrics.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Negative or invalid SQP metric for ${term.marketplace}/${term.asin}/${term.searchQuery}`);
  }
  if (term.selectionBasis === "sqp_purchase" && term.asinPurchaseCount <= 0) {
    throw new Error(`SQP purchase term lacks purchases: ${term.searchQuery}`);
  }
  if (term.selectionBasis === "sqp_cart" && (term.asinPurchaseCount > 0 || term.asinCartAddCount <= 0)) {
    throw new Error(`SQP cart term violates purchase/cart evidence tier: ${term.searchQuery}`);
  }
  const clickQualifies = term.asinClickCount >= 2 || (term.asinClickCount >= 1 && term.searchQueryVolume >= 20);
  if (term.selectionBasis === "sqp_click" && (term.asinPurchaseCount > 0 || term.asinCartAddCount > 0 || !clickQualifies)) {
    throw new Error(`SQP click term lacks qualifying click evidence: ${term.searchQuery}`);
  }
  if (term.selectionBasis === "title_fallback" && (term.asinPurchaseCount !== 0 || term.asinCartAddCount !== 0 || term.asinClickCount !== 0)) {
    throw new Error(`Title fallback must not be submitted as observed funnel evidence: ${term.searchQuery}`);
  }
}

/**
 * Replaces the active core-keyword set only after receiving one complete,
 * 6–20-term selection for every live FBA listing. Matching keyword rows retain
 * all rank, ad, SBV, CPR, and historical snapshot data; retired terms are
 * marked non-core instead of deleted so this receiver never destroys metrics.
 */
export async function applySqpKeywordSelections(input: { listings: SqpKeywordListingInput[]; observedAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const liveListings = await getListings();
  if (!liveListings.length) throw new Error("No active FBA listings available for SQP keyword maintenance");

  const liveByKey = new Map<string, (typeof liveListings)[number]>(liveListings.map(listing => [`${listing.marketplace}:${normalizeIngestAsin(listing.asin)}`, listing]));
  const receivedKeys = input.listings.map(item => `${item.marketplace}:${normalizeIngestAsin(item.asin)}`);
  if (receivedKeys.length !== liveByKey.size || new Set(receivedKeys).size !== receivedKeys.length) {
    throw new Error(`SQP listing batch mismatch: expected ${liveByKey.size}, received ${receivedKeys.length}, unique=${new Set(receivedKeys).size}`);
  }
  const missing = Array.from(liveByKey.keys()).filter(key => !receivedKeys.includes(key));
  const extra = receivedKeys.filter(key => !liveByKey.has(key));
  if (missing.length || extra.length) throw new Error(`SQP listing targets mismatch: missing=${missing.length}, extra=${extra.length}`);

  const prepared = input.listings.map(item => {
    const listingKey = `${item.marketplace}:${normalizeIngestAsin(item.asin)}`;
    const listing = liveByKey.get(listingKey);
    if (!listing) throw new Error(`Unknown active FBA listing ${listingKey}`);
    if (item.terms.length < 6 || item.terms.length > 20) {
      throw new Error(`SQP core term count must be 6–20 for ${listingKey}; received ${item.terms.length}`);
    }
    const termKeys = item.terms.map(term => normalizeIngestKeyword(term.searchQuery));
    if (termKeys.some(key => !key) || new Set(termKeys).size !== termKeys.length) {
      throw new Error(`SQP term list contains missing or duplicate normalized search queries for ${listingKey}`);
    }
    return {
      listing,
      terms: item.terms.map(term => {
        if (term.marketplace !== listing.marketplace || normalizeIngestAsin(term.asin) !== normalizeIngestAsin(listing.asin)) {
          throw new Error(`SQP term does not belong to ${listingKey}`);
        }
        assertSqpSelectionEvidence(term);
        const selectionBasis = term.selectionBasis;
        return {
          ...term,
          normalizedKeyword: normalizeIngestKeyword(term.searchQuery),
          source: selectionBasis === "title_fallback" ? "organic_high_value" as const : "sqp_converting" as const,
          relevanceScore: selectionBasis === "title_fallback" ? 65 : Math.max(1, 101 - Math.min(100, term.searchQueryScore || 100)),
        };
      }),
    };
  });

  const result = { observedAt: input.observedAt.toISOString(), expectedListings: liveByKey.size, updated: 0, created: 0, retired: 0, totalCoreTerms: 0, byBasis: { sqp_purchase: 0, sqp_cart: 0, sqp_click: 0, title_fallback: 0 } };
  await db.transaction(async tx => {
    const listingIds = prepared.map(item => item.listing.id);
    const existingKeywords = await tx.select().from(keywords).where(inArray(keywords.listingId, listingIds));
    const existingByKey = new Map<string, (typeof existingKeywords)[number]>();
    for (const existing of existingKeywords) {
      const key = `${existing.listingId}:${normalizeIngestKeyword(existing.keyword)}`;
      if (existingByKey.has(key)) throw new Error(`Existing duplicate keyword rows for ${key}; no SQP update applied`);
      existingByKey.set(key, existing);
    }

    for (const existing of existingKeywords.filter(keyword => keyword.isCore)) {
      await tx.update(keywords).set({ isCore: false, updatedAt: input.observedAt }).where(eq(keywords.id, existing.id));
      result.retired += 1;
    }

    for (const item of prepared) {
      for (const term of item.terms) {
        const existing = existingByKey.get(`${item.listing.id}:${term.normalizedKeyword}`);
        const keywordPayload = {
          keyword: term.normalizedKeyword,
          searchVolume: Math.trunc(term.searchQueryVolume),
          historicalConversionCount: Math.trunc(term.asinPurchaseCount),
          conversionRate: term.asinConversionRate.toFixed(2),
          relevanceScore: Math.trunc(term.relevanceScore),
          isCore: true,
          source: term.source,
          selectionBasis: term.selectionBasis,
          updatedAt: input.observedAt,
        };
        if (existing) {
          await tx.update(keywords).set(keywordPayload).where(eq(keywords.id, existing.id));
          result.updated += 1;
        } else {
          await tx.insert(keywords).values({
            listingId: item.listing.id,
            ...keywordPayload,
            currentRank: 0,
            previousRank: 0,
            rankChange: 0,
            bestRank: 0,
            pageNumber: 0,
            createdAt: input.observedAt,
          });
          result.created += 1;
        }
        result.totalCoreTerms += 1;
        result.byBasis[term.selectionBasis] += 1;
      }
    }
  });
  return result;
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
  return db.select().from(keywords).where(and(eq(keywords.listingId, listingId), eq(keywords.isCore, true))).orderBy(desc(keywords.historicalConversionCount));
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
    manualExceptionCount: 0,
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

  const allKeywords = await db.select().from(keywords).where(and(inArray(keywords.listingId, listingIds), eq(keywords.isCore, true)));
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
    manualExceptionCount: allListings.filter(l => isManualCategoryException(l.marketplace, l.asin)).length,
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

/**
 * Performs a deliberately scoped four-metric recovery in a single database transaction.
 * This is reserved for an operator-approved temporary exclusion; the excluded listing is
 * validated against the live target set so a partial run can never silently broaden scope.
 */
export type PartialFourMetricInput = {
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

export async function applyPartialRealFourMetrics(
  snapshotDate: string,
  metrics: PartialFourMetricInput[],
  observedAt: Date,
  excluded: Array<{ marketplace: "US" | "CA" | "JP"; asin: string }>
) {
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
  if (!excluded.length || new Set(excluded.map(item => `${item.marketplace}:${item.asin.trim().toUpperCase()}`)).size !== excluded.length) {
    throw new Error("Partial recovery exclusions must be non-empty and unique");
  }
  const excludedKeys = new Set(excluded.map(item => `${item.marketplace}:${item.asin.trim().toUpperCase()}`));
  const expectedByKey = new Map(coreKeywords.flatMap(keyword => {
    const listing = listingById.get(keyword.listingId);
    if (!listing) throw new Error(`Missing Listing for keyword ${keyword.id}`);
    const listingKey = `${listing.marketplace}:${listing.asin.trim().toUpperCase()}`;
    return excludedKeys.has(listingKey) ? [] : [[rankTargetKey(listing.marketplace, listing.asin, keyword.keyword), { listing, keyword }] as const];
  }));
  const excludedKeywords = coreKeywords.filter(keyword => {
    const listing = listingById.get(keyword.listingId);
    return listing && excludedKeys.has(`${listing.marketplace}:${listing.asin.trim().toUpperCase()}`);
  });
  if (!excludedKeywords.length) throw new Error("None of the requested temporary exclusions are active FBA core-keyword targets");

  const actualKeys = metrics.map(item => rankTargetKey(item.marketplace, item.asin, item.keyword));
  if (actualKeys.length !== expectedByKey.size || new Set(actualKeys).size !== actualKeys.length) {
    throw new Error(`Partial four-metric batch mismatch: expected=${expectedByKey.size}, received=${actualKeys.length}, unique=${new Set(actualKeys).size}`);
  }
  const missing = Array.from(expectedByKey.keys()).filter(key => !actualKeys.includes(key));
  const extra = actualKeys.filter(key => !expectedByKey.has(key));
  if (missing.length || extra.length) throw new Error(`Partial four-metric target mismatch: missing=${missing.length}, extra=${extra.length}`);

  const prepared = metrics.map(metric => {
    const target = expectedByKey.get(rankTargetKey(metric.marketplace, metric.asin, metric.keyword));
    if (!target) throw new Error(`Unknown partial metric target ${metric.marketplace}/${metric.asin}/${metric.keyword}`);
    const naturalRank = Math.trunc(metric.naturalRank);
    const page = Math.trunc(metric.page);
    const pcAdRank = Math.trunc(metric.pcAdRank);
    const pcSbvRank = Math.trunc(metric.pcSbvRank);
    const sampleCount = Math.trunc(metric.cprSampleCount);
    const cprEstimate = metric.cprEstimate === null ? null : Math.trunc(metric.cprEstimate);
    const monthlySalesAverage = metric.monthlySalesAverage === null ? null : Math.trunc(metric.monthlySalesAverage);
    if (naturalRank < 1 || naturalRank > 999 || page < 1 || page > 4 || pcAdRank < 1 || pcAdRank > 999 || pcSbvRank < 1 || pcSbvRank > 999) {
      throw new Error(`Invalid rank metric ${metric.marketplace}/${metric.asin}/${metric.keyword}`);
    }
    if (sampleCount < 0 || sampleCount > 10 || (cprEstimate === null && monthlySalesAverage !== null) || (cprEstimate !== null && (cprEstimate < 1 || monthlySalesAverage === null || monthlySalesAverage < 0 || sampleCount < 5))) {
      throw new Error(`Invalid CPR metric ${metric.marketplace}/${metric.asin}/${metric.keyword}`);
    }
    const oldRank = target.keyword.currentRank && target.keyword.currentRank > 0 ? target.keyword.currentRank : 0;
    const rankChange = oldRank > 0 ? oldRank - naturalRank : 0;
    const oldBest = target.keyword.bestRank ?? 0;
    const bestRank = naturalRank < 999 ? (oldBest > 0 ? Math.min(oldBest, naturalRank) : naturalRank) : oldBest;
    return { ...target, naturalRank, page, pcAdRank, pcSbvRank, sampleCount, cprEstimate, monthlySalesAverage, rankChange, bestRank };
  });

  await db.transaction(async tx => {
    const keywordIds = prepared.map(item => item.keyword.id);
    if (keywordIds.length) {
      await tx.delete(dailyRankSnapshots).where(and(eq(dailyRankSnapshots.snapshotDate, snapshotDate), inArray(dailyRankSnapshots.keywordId, keywordIds)));
    }
    for (const item of prepared) {
      await tx.update(keywords).set({
        currentRank: item.naturalRank,
        previousRank: item.keyword.currentRank && item.keyword.currentRank > 0 ? item.keyword.currentRank : 0,
        rankChange: item.rankChange,
        bestRank: item.bestRank,
        pageNumber: item.page,
        pcAdRank: item.pcAdRank,
        pcSbvRank: item.pcSbvRank,
        cprEstimate: item.cprEstimate,
        cprMonthlySalesAverage: item.monthlySalesAverage,
        cprSampleCount: item.sampleCount,
        cprSource: "dataforseo_amazon_pc_serp",
        cprUpdatedAt: observedAt,
        updatedAt: observedAt,
      }).where(eq(keywords.id, item.keyword.id));
      await tx.insert(dailyRankSnapshots).values({
        keywordId: item.keyword.id,
        listingId: item.listing.id,
        marketplace: item.listing.marketplace,
        snapshotDate,
        rank: item.naturalRank,
        page: item.page,
        pcAdRank: item.pcAdRank,
        pcSbvRank: item.pcSbvRank,
        changeFromYesterday: item.rankChange,
        isTop10: item.naturalRank <= 10,
        isTop50: item.naturalRank <= 50,
      });
    }
  });

  return {
    snapshotDate,
    expected: expectedByKey.size,
    updated: prepared.length,
    excluded: { listings: excluded, keywords: excludedKeywords.length },
    rank: { updated: prepared.length, top10: prepared.filter(item => item.naturalRank <= 10).length, top50: prepared.filter(item => item.naturalRank <= 50).length, outsideTopThreePages: prepared.filter(item => item.naturalRank === 999).length },
    cpr: { updated: prepared.length, calculated: prepared.filter(item => item.cprEstimate !== null).length, insufficientEvidence: prepared.filter(item => item.cprEstimate === null).length },
    ads: { updated: prepared.length, pcAdFound: prepared.filter(item => item.pcAdRank < 999).length, pcSbvFound: prepared.filter(item => item.pcSbvRank < 999).length, neitherFound: prepared.filter(item => item.pcAdRank === 999 && item.pcSbvRank === 999).length },
  };
}
