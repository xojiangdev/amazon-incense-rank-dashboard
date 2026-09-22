import { describe, expect, it } from "vitest";
import { applyGitHubCprDocument, getDb, getGitHubCprSyncState } from "./db";
import { cprSyncStates, keywords, listings } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { GITHUB_CPR_RAW_URL, parseGitHubCprDocument } from "../shared/githubCpr";

describe("applyGitHubCprDocument", () => {
  it("updates CPR only for matched active core keywords and marks status", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database required");

    const activeListing = (await db.select().from(listings).where(and(
      eq(listings.fulfillmentChannel, "FBA"),
      eq(listings.inventoryStatus, "Active"),
    )).limit(1))[0];
    if (!activeListing) throw new Error("Active FBA Listing required for test");

    const sampleCoreKeyword = (await db.select().from(keywords).where(and(
      eq(keywords.listingId, activeListing.id),
      eq(keywords.isCore, true),
    )).limit(1))[0];
    if (!sampleCoreKeyword) throw new Error("Active core keyword required for test");

    const testSourceKey = `test:github:cpr:${Date.now()}`;
    const normalizedKeyword = sampleCoreKeyword.keyword.trim().normalize("NFKC").toLowerCase();
    const matchingBefore = (await db.select().from(keywords).where(eq(keywords.isCore, true))).filter(keyword =>
      keyword.keyword.trim().normalize("NFKC").toLowerCase() === normalizedKeyword
    );
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
      const firstResult = await applyGitHubCprDocument({
        sourceKey: testSourceKey,
        sourceUrl: GITHUB_CPR_RAW_URL,
        remoteSha: sha1,
        remoteUpdatedAt: date1,
        document: testDoc,
      });

      expect(firstResult.status).toBe("applied");
      expect(firstResult.updated).toBeGreaterThanOrEqual(1);

      const reloadedKeyword = (await db.select().from(keywords).where(eq(keywords.id, sampleCoreKeyword.id)))[0];
      expect(reloadedKeyword?.cprEstimate).toBe(77);
      expect(reloadedKeyword?.cprMonthlySalesAverage).toBe(288);
      expect(reloadedKeyword?.cprSampleCount).toBe(9);
      expect(reloadedKeyword?.cprSource).toBe(`github_cpr_json:${sha1}`);

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
    } finally {
      await db.transaction(async tx => {
        for (const original of matchingBefore) {
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
