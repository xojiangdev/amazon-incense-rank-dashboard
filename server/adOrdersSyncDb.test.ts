import { describe, expect, it } from "vitest";
import { and, eq, gt, inArray } from "drizzle-orm";
import { applyAdOrders, getDb } from "./db";
import { keywords, listings } from "../drizzle/schema";

describe("applyAdOrders", () => {
  it("updates matched ad purchases, clears missing rows for active listings, and restores original values", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    const activeListings = await db.select().from(listings).where(and(
      eq(listings.marketplace, "US"),
      eq(listings.fulfillmentChannel, "FBA"),
      eq(listings.inventoryStatus, "Active"),
      gt(listings.fbaStock, 0),
    ));
    const activeListing = activeListings[0];
    if (!activeListing) throw new Error("Active US FBA listing required for ad order test");

    const activeCoreBefore = await db.select().from(keywords).where(and(
      inArray(keywords.listingId, activeListings.map(listing => listing.id)),
      eq(keywords.isCore, true),
    ));
    const matchedCore = activeCoreBefore.find(keyword => keyword.listingId === activeListing.id);
    if (!matchedCore) throw new Error("Active core keyword required for ad order test");

    const observedAt = new Date("2026-09-24T09:30:00.000Z");

    try {
      const result = await applyAdOrders(
        "US",
        [
          {
            asin: activeListing.asin,
            keyword: matchedCore.keyword,
            adPurchases: 7,
          },
        ],
        observedAt
      );

      expect(result.received).toBe(1);
      expect(result.updated).toBeGreaterThanOrEqual(1);

      const reloadedMatched = (await db.select().from(keywords).where(eq(keywords.id, matchedCore.id)))[0];
      expect(reloadedMatched?.adPurchases).toBe(7);

      const otherKeywords = await db.select().from(keywords).where(and(
        eq(keywords.listingId, activeListing.id),
        eq(keywords.isCore, true),
      ));
      const clearedKeyword = otherKeywords.find(keyword => keyword.id !== matchedCore.id);
      if (clearedKeyword) {
        expect(clearedKeyword.adPurchases).toBeNull();
      }
    } finally {
      await db.transaction(async tx => {
        for (const original of activeCoreBefore) {
          await tx.update(keywords).set({
            adPurchases: original.adPurchases,
            updatedAt: original.updatedAt,
          }).where(eq(keywords.id, original.id));
        }
      });
    }
  });
});
