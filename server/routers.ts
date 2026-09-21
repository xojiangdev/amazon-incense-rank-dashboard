import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  addSalesLog,
  getDashboardOverview,
  getListingById,
  getListingKeywords,
  getListings,
  getRankSnapshots,
  getSalesLogs,
  getStoreSettings,
  updateListingFollowUp,
  updateStoreSettings,
} from "./db";
import { runDailyRankSnapshot, upsertSyncedListing } from "./rankEngine";

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
            marketplace: z.enum(["US", "CA"]).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return getDashboardOverview(input?.marketplace);
      }),

    listings: publicProcedure
      .input(
        z
          .object({
            marketplace: z.enum(["US", "CA"]).optional(),
            category: z.string().optional(),
            status: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        return getListings(input?.marketplace, input?.category, input?.status);
      }),

    listingDetail: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const listing = await getListingById(input.id);
        if (!listing) return null;
        const keywordsList = await getListingKeywords(input.id);
        const snapshots = await getRankSnapshots(input.id);
        const logs = await getSalesLogs(input.id);
        return {
          listing,
          keywords: keywordsList,
          snapshots,
          logs,
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
          marketplace: z.enum(["US", "CA"]),
          asin: z.string().min(10).max(10),
          sku: z.string().optional(),
          title: z.string().min(5),
          categoryName: z.string().optional(),
          price: z.string().optional(),
          fbaStock: z.number().optional(),
          assignedSales: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return upsertSyncedListing(input);
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
