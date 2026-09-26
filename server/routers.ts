import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  addSalesLog,
  getAdCampaigns,
  bulkUpdateListingOrganization,
  getGitHubCprSyncState,
  getDashboardOverview,
  getListingById,
  getListingKeywords,
  getListings,
  getRankSnapshots,
  getSalesLogs,
  getStoreSettings,
  reorderListings as persistListingOrder,
  updateListingFollowUp,
  updateListingOrganization,
  updateStoreSettings,
} from "./db";
import { bulkListingOrganizationInputSchema, listingOrganizationInputSchema, reorderListingsInputSchema } from "./listingOrganization";
import { runDailyRankSnapshot, upsertSyncedListing } from "./rankEngine";
import { GITHUB_CPR_SOURCE_KEY } from "../shared/githubCpr";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  dashboard: router({
    overview: publicProcedure
      .input(
        z
          .object({
            marketplace: z.enum(["US", "CA", "JP"]).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return getDashboardOverview(input?.marketplace);
      }),

    cprSyncStatus: publicProcedure.query(async () => {
      return getGitHubCprSyncState(GITHUB_CPR_SOURCE_KEY);
    }),

    listings: publicProcedure
      .input(
        z
          .object({
            marketplace: z.enum(["US", "CA", "JP"]).optional(),
            category: z.string().optional(),
            status: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return getListings(input?.marketplace, input?.category, input?.status);
      }),

    adCampaigns: publicProcedure
      .input(
        z
          .object({ marketplace: z.enum(["US", "CA", "JP"]).optional() })
          .optional()
      )
      .query(async ({ input }) => {
        return getAdCampaigns(input?.marketplace);
      }),

    listingDetail: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const listing = await getListingById(input.id);
        if (!listing) return null;
        const keywordsList = await getListingKeywords(input.id);
        const snapshots = await getRankSnapshots(input.id);
        const logs = await getSalesLogs(input.id);
        // 该ASIN的启用广告系列(供详情页"广告概况"卡片)
        const campaigns = await getAdCampaigns(listing.marketplace).catch(() => []);
        const asinCampaigns = campaigns.filter(c => c.asins.includes(listing.asin));
        return {
          listing,
          keywords: keywordsList,
          snapshots,
          logs,
          adCampaigns: asinCampaigns,
        };
      }),

    triggerDailyRefresh: publicProcedure
      .input(z.object({ listingId: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        return runDailyRankSnapshot(input?.listingId);
      }),

    updateFollowUp: publicProcedure
      .input(
        z.object({
          listingId: z.number(),
          status: z.enum(["normal", "watch", "action_needed", "optimizing"]),
          notes: z.string().optional(),
          logContent: z.string().optional(),
          salesName: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const updated = await updateListingFollowUp(input.listingId, input.status, input.notes);
        if (input.logContent) {
          await addSalesLog(input.listingId, input.salesName || "销售专员", input.logContent, "人工状态更新");
        }
        return updated;
      }),

    reorderListings: publicProcedure
      .input(reorderListingsInputSchema)
      .mutation(async ({ input }) => {
        return persistListingOrder(input.orderedIds);
      }),

    updateListingOrganization: publicProcedure
      .input(listingOrganizationInputSchema)
      .mutation(async ({ input }) => {
        const updated = await updateListingOrganization(
          input.listingId,
          input.salesCategory,
          input.customCategoryLabel,
          input.salesNotes
        );
        const categoryLabels = {
          unclassified: "未分类",
          new_product: "新品",
          key_product: "重点产品",
          long_tail: "长尾产品",
          regular: "常规产品",
          discontinued: "DISCONTINUED",
          custom: input.customCategoryLabel?.trim() || "自定义",
        };
        await addSalesLog(
          input.listingId,
          "销售团队",
          `产品分类：${categoryLabels[input.salesCategory]}${input.salesNotes?.trim() ? `；自由备注：${input.salesNotes.trim()}` : ""}`,
          "商品分类与备注"
        );
        return updated;
      }),

    bulkUpdateListingOrganization: publicProcedure
      .input(bulkListingOrganizationInputSchema)
      .mutation(async ({ input }) => {
        return bulkUpdateListingOrganization(input);
      }),

    addSalesNote: publicProcedure
      .input(
        z.object({
          listingId: z.number(),
          author: z.string().min(1),
          content: z.string().min(1),
          actionType: z.string().optional(),
          suggestedAction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return addSalesLog(input.listingId, input.author, input.content, input.actionType || "销售复盘", input.suggestedAction);
      }),

    importListingManual: publicProcedure
      .input(
        z.object({
          marketplace: z.enum(["US", "CA", "JP"]),
          asin: z.string().min(10).max(10),
          sku: z.string().optional(),
          title: z.string().min(5),
          categoryName: z.string().optional(),
          price: z.string().optional(),
          fbaStock: z.number().int().positive().optional(),
          assignedSales: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Only the explicitly approved ASIN allow-list in rankEngine can use
        // this manual-only override; every other non-incense ASIN remains
        // rejected by the category guard.
        return upsertSyncedListing({ ...input, manualCategoryOverride: true });
      }),

    settings: publicProcedure.query(async () => {
      return getStoreSettings();
    }),

    updateSettings: publicProcedure
      .input(
        z.object({
          sellerId: z.string().optional(),
          spapiRefreshToken: z.string().optional(),
          adsProfileUs: z.string().optional(),
          adsProfileCa: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return updateStoreSettings(input);
      }),
  }),
});

export type AppRouter = typeof appRouter;
