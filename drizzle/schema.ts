import { boolean, decimal, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const stores = mysqlTable("stores", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  sellerId: varchar("sellerId", { length: 64 }).default(""),
  spapiRefreshToken: text("spapiRefreshToken"),
  adsProfileUs: varchar("adsProfileUs", { length: 64 }).default("898659032586056"),
  adsProfileCa: varchar("adsProfileCa", { length: 64 }).default("673034626677273"),
  syncStatus: mysqlEnum("syncStatus", ["idle", "syncing", "success", "error"]).default("idle").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull(),
  marketplace: mysqlEnum("marketplace", ["US", "CA", "JP"]).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  parentAsin: varchar("parentAsin", { length: 20 }),
  sku: varchar("sku", { length: 100 }),
  title: text("title").notNull(),
  category: mysqlEnum("category", ["incense_sticks", "incense_burner", "incense_holder", "other"]).notNull(),
  categoryName: varchar("categoryName", { length: 120 }).default(""),
  imageUrl: text("imageUrl"),
  price: decimal("price", { precision: 10, scale: 2 }).default("0.00"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  fulfillmentChannel: mysqlEnum("fulfillmentChannel", ["FBA", "FBM"]).default("FBA").notNull(),
  inventoryStatus: mysqlEnum("inventoryStatus", ["Active", "Inactive", "Out of Stock"]).default("Active").notNull(),
  fbaStock: int("fbaStock").default(0),
  fbaInboundWorking: int("fbaInboundWorking").default(0).notNull(),
  fbaInboundShipped: int("fbaInboundShipped").default(0).notNull(),
  fbaInboundReceiving: int("fbaInboundReceiving").default(0).notNull(),
  fbaInboundTotal: int("fbaInboundTotal").default(0).notNull(),
  reviewRating: decimal("reviewRating", { precision: 3, scale: 2 }),
  reviewCount: int("reviewCount"),
  reviewMetricsSource: varchar("reviewMetricsSource", { length: 40 }),
  reviewMetricsUpdatedAt: timestamp("reviewMetricsUpdatedAt"),
  manualSortOrder: int("manualSortOrder").default(0).notNull(),
  salesCategory: mysqlEnum("salesCategory", [
    "unclassified",
    "new_product",
    "key_product",
    "long_tail",
    "regular",
    "discontinued",
    "custom",
  ]).default("unclassified").notNull(),
  customCategoryLabel: varchar("customCategoryLabel", { length: 80 }),
  salesNotes: text("salesNotes"),
  salesFollowUpStatus: mysqlEnum("salesFollowUpStatus", ["normal", "watch", "action_needed", "optimizing"]).default("normal").notNull(),
  assignedSales: varchar("assignedSales", { length: 100 }).default("销售组"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const keywords = mysqlTable("keywords", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull(),
  keyword: varchar("keyword", { length: 255 }).notNull(),
  searchVolume: int("searchVolume").default(0),
  historicalConversionCount: int("historicalConversionCount").default(0),
  conversionRate: decimal("conversionRate", { precision: 5, scale: 2 }).default("0.00"),
  relevanceScore: int("relevanceScore").default(85),
  isCore: boolean("isCore").default(true).notNull(),
  source: mysqlEnum("source", ["sqp_converting", "ads_converting", "organic_high_value", "manual_selected"]).default("sqp_converting").notNull(),
  selectionBasis: mysqlEnum("selectionBasis", ["sqp_purchase", "sqp_cart", "sqp_click", "title_fallback", "manual_review"]).default("manual_review").notNull(),
  currentRank: int("currentRank").default(0),
  previousRank: int("previousRank").default(0),
  rankChange: int("rankChange").default(0),
  bestRank: int("bestRank").default(0),
  pageNumber: int("pageNumber").default(0),
  cprEstimate: int("cprEstimate"),
  adPurchases: int("adPurchases"),
  cprMonthlySalesAverage: int("cprMonthlySalesAverage"),
  cprSampleCount: int("cprSampleCount"),
  cprSource: varchar("cprSource", { length: 64 }),
  cprUpdatedAt: timestamp("cprUpdatedAt"),
  pcAdRank: int("pcAdRank"),
  pcSbvRank: int("pcSbvRank"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const dailyRankSnapshots = mysqlTable("daily_rank_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  keywordId: int("keywordId").notNull(),
  listingId: int("listingId").notNull(),
  marketplace: mysqlEnum("marketplace", ["US", "CA", "JP"]).notNull(),
  snapshotDate: varchar("snapshotDate", { length: 20 }).notNull(),
  rank: int("rank").notNull(),
  page: int("page").default(1).notNull(),
  pcAdRank: int("pcAdRank"),
  pcSbvRank: int("pcSbvRank"),
  changeFromYesterday: int("changeFromYesterday").default(0),
  isTop10: boolean("isTop10").default(false).notNull(),
  isTop50: boolean("isTop50").default(false).notNull(),
  trackedAt: timestamp("trackedAt").defaultNow().notNull(),
});

/**
 * A single durable checkpoint for the repository-owned CPR feed. The remote
 * SHA and generated timestamp make every scheduled poll idempotent and allow
 * the dashboard to reject stale repository files without touching rank data.
 */
export const cprSyncStates = mysqlTable("cpr_sync_states", {
  id: int("id").autoincrement().primaryKey(),
  sourceKey: varchar("sourceKey", { length: 255 }).notNull().unique(),
  sourceUrl: text("sourceUrl").notNull(),
  remoteSha: varchar("remoteSha", { length: 64 }),
  remoteUpdatedAt: timestamp("remoteUpdatedAt"),
  sourceGeneratedAt: timestamp("sourceGeneratedAt"),
  calibration: text("calibration"),
  sourceRecordCount: int("sourceRecordCount").default(0).notNull(),
  matchedKeywordCount: int("matchedKeywordCount").default(0).notNull(),
  updatedKeywordCount: int("updatedKeywordCount").default(0).notNull(),
  lastCheckedAt: timestamp("lastCheckedAt").defaultNow().notNull(),
  lastAppliedAt: timestamp("lastAppliedAt"),
  lastStatus: varchar("lastStatus", { length: 32 }).default("never").notNull(),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const salesLogs = mysqlTable("sales_logs", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull(),
  author: varchar("author", { length: 100 }).notNull(),
  actionType: varchar("actionType", { length: 50 }).default("销售复盘").notNull(),
  content: text("content").notNull(),
  suggestedAction: text("suggestedAction"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// 广告系列监控(每日推送的聚合快照; summary/asins 为 JSON 文本)
export const adCampaigns = mysqlTable("ad_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  marketplace: mysqlEnum("marketplace", ["US", "CA", "JP"]).notNull(),
  campaignId: varchar("campaignId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  budget: decimal("budget", { precision: 10, scale: 2 }),
  targetingType: varchar("targetingType", { length: 64 }),
  bucket: varchar("bucket", { length: 32 }),
  asins: text("asins").notNull(),
  endDate: varchar("endDate", { length: 10 }).notNull(),
  summary: text("summary").notNull(),
  adGroups: text("adGroups").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ad_campaigns_market_campaign_uq").on(table.marketplace, table.campaignId),
]);

export type AdCampaignRow = typeof adCampaigns.$inferSelect;
