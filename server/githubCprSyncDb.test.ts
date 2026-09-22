import { describe, expect, it } from "vitest";
import { applyGitHubCprDocument, getDb, getGitHubCprSyncState } from "./db";
import { cprSyncStates, keywords, listings } from "../drizzle/schema";
import { and, eq, gt, inArray } from "drizzle-orm";
import { GITHUB_CPR_RAW_URL, parseGitHubCprDocument } from "../shared/githubCpr";

describe("applyGitHubCprDocument", () => {
  it("updates matched CPR, clears absent authoritative records, and restores every mutated row", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database required");

    const activeListings = await db.select().from(listings).where(and(
      eq(listings.fulfillmentChannel, "FBA"),
      eq(listings.inventoryStatus, "Active"),
      gt(listings.fbaStock, 0),
    ));
    const activeListing = activeListings[0];
    if (!activeListing) throw new Error("Active FBA Listing required for test");

    const activeCoreBefore = await db.select().from(keywords).where(and(
      inArray(keywords.listingId, activeListings.map(listing => listing.id)),
      eq(keywords.isCore, true),
    ));
    const sampleCoreKeyword = activeCoreBefore.find(keyword => keyword.listingId === activeListing.id);
    if (!sampleCoreKeyword) throw new Error("Active core keyword required for test");

    const testSourceKey = `test:github:cpr:${Date.now()}`;
    const normalizedKeyword = sampleCoreKeyword.keyword.trim().normalize("NFKC").toLowerCase();
    const absentKeyword = activeCoreBefore.find(keyword =>
      keyword.keyword.trim().normalize("NFKC").toLowerCase() !== normalizedKeyword
    );
    if (!absentKeyword) throw new Error("A distinct active core keyword is required to test authoritative clearing");
    const testDoc = parseGitHubCprDocument({
      meta: {
        generated_at: "2026-09-22T07:25:00.000Z",
        calib: { test: true },
      },
      data: [
        {
          keyword: sampleCoreKeyword.keyword,
          cpr: 77,
          avg_monthly_sales: 288,
          samples: 9,
        },
      ],
    });

    const sha1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const date1 = new Date("2026-09-22T07:25:00.000Z");

    try {
      await db.update(keywords).set({
        cprEstimate: 2,
        cprMonthlySalesAverage: 8,
        cprSampleCount: 5,
        cprSource: "github_cpr_json:stale-authoritative-record",
        cprUpdatedAt: new Date("2026-09-20T00:00:00.000Z"),
      }).where(eq(keywords.id, absentKeyword.id));

      const firstResult = await applyGitHubCprDocument({
        sourceKey: testSourceKey,
        sourceUrl: GITHUB_CPR_RAW_URL,
        remoteSha: sha1,
        remoteUpdatedAt: date1,
        document: testDoc,
      });

      expect(firstResult.status).toBe("applied");
      expect(firstResult.updated).toBeGreaterThanOrEqual(1);
      expect(firstResult.cleared).toBeGreaterThanOrEqual(1);
      expect(firstResult.updated).toBe(firstResult.matched + firstResult.cleared);

      const reloadedKeyword = (await db.select().from(keywords).where(eq(keywords.id, sampleCoreKeyword.id)))[0];
      expect(reloadedKeyword?.cprEstimate).toBe(77);
      expect(reloadedKeyword?.cprMonthlySalesAverage).toBe(288);
      expect(reloadedKeyword?.cprSampleCount).toBe(9);
      expect(reloadedKeyword?.cprSource).toBe(`github_cpr_json:${sha1}`);

      const reloadedAbsentKeyword = (await db.select().from(keywords).where(eq(keywords.id, absentKeyword.id)))[0];
      expect(reloadedAbsentKeyword?.cprEstimate).toBeNull();
      expect(reloadedAbsentKeyword?.cprMonthlySalesAverage).toBeNull();
      expect(reloadedAbsentKeyword?.cprSampleCount).toBeNull();
      expect(reloadedAbsentKeyword?.cprSource).toBeNull();

      const state = await getGitHubCprSyncState(testSourceKey);
      expect(state?.lastStatus).toBe("applied");
      expect(state?.remoteSha).toBe(sha1);

      // Stale or equal timestamp should be rejected as not_newer
      const secondResult = await applyGitHubCprDocument({
        sourceKey: testSourceKey,
        sourceUrl: GITHUB_CPR_RAW_URL,
        remoteSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        remoteUpdatedAt: new Date("2026-09-22T07:20:00.000Z"),
        document: testDoc,
      });
      expect(secondResult.status).toBe("not_newer");
      expect(secondResult.updated).toBe(0);
      expect(secondResult.cleared).toBe(0);

      // A local reconciliation recovery must reapply the same document without
      // forging a newer Git commit version.
      const forcedResult = await applyGitHubCprDocument({
        sourceKey: testSourceKey,
        sourceUrl: GITHUB_CPR_RAW_URL,
        remoteSha: sha1,
        remoteUpdatedAt: date1,
        document: testDoc,
        force: true,
      });
      expect(forcedResult.status).toBe("applied");
      expect(forcedResult.matched).toBeGreaterThanOrEqual(1);
    } finally {
      await db.transaction(async tx => {
        for (const original of activeCoreBefore) {
          await tx.update(keywords).set({
            cprEstimate: original.cprEstimate,
            cprMonthlySalesAverage: original.cprMonthlySalesAverage,
            cprSampleCount: original.cprSampleCount,
            cprSource: original.cprSource,
            cprUpdatedAt: original.cprUpdatedAt,
            updatedAt: original.updatedAt,
          }).where(eq(keywords.id, original.id));
        }
        await tx.delete(cprSyncStates).where(eq(cprSyncStates.sourceKey, testSourceKey));
      });
    }
  });
});
