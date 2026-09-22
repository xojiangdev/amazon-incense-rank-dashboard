import fs from "node:fs";
import { and, eq, gt, inArray } from "drizzle-orm";
import { keywords, listings } from "./drizzle/schema";
import { getDb, getGitHubCprSyncState } from "./server/db";
import { GITHUB_CPR_SOURCE_KEY, parseGitHubCprDocument } from "./shared/githubCpr";

const normalize = (value: string) => value.trim().normalize("NFKC").toLowerCase();

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const document = parseGitHubCprDocument(JSON.parse(fs.readFileSync("data/cpr.json", "utf8")));
  const documentKeywords = new Set(document.records.map(record => record.normalizedKeyword));
  const activeListings = await db.select().from(listings).where(and(
    eq(listings.fulfillmentChannel, "FBA"),
    eq(listings.inventoryStatus, "Active"),
    gt(listings.fbaStock, 0),
  ));
  const activeCoreKeywords = activeListings.length
    ? await db.select().from(keywords).where(and(
      inArray(keywords.listingId, activeListings.map(listing => listing.id)),
      eq(keywords.isCore, true),
    ))
    : [];

  const absentFromDocument = activeCoreKeywords.filter(keyword => !documentKeywords.has(normalize(keyword.keyword)));
  const staleAbsent = absentFromDocument.filter(keyword =>
    keyword.cprEstimate !== null ||
    keyword.cprMonthlySalesAverage !== null ||
    keyword.cprSampleCount !== null ||
    keyword.cprSource !== null
  );
  const state = await getGitHubCprSyncState(GITHUB_CPR_SOURCE_KEY);
  console.log(JSON.stringify({
    activeCoreKeywords: activeCoreKeywords.length,
    sourceRecords: document.records.length,
    documentMatchedRows: activeCoreKeywords.length - absentFromDocument.length,
    absentFromDocumentRows: absentFromDocument.length,
    staleAbsentRows: staleAbsent.length,
    staleAbsentExamples: staleAbsent.slice(0, 10).map(keyword => ({
      id: keyword.id,
      keyword: keyword.keyword,
      cprEstimate: keyword.cprEstimate,
      cprSource: keyword.cprSource,
    })),
    syncState: state ? {
      remoteSha: state.remoteSha,
      sourceRecordCount: state.sourceRecordCount,
      matchedKeywordCount: state.matchedKeywordCount,
      updatedKeywordCount: state.updatedKeywordCount,
      lastStatus: state.lastStatus,
      lastAppliedAt: state.lastAppliedAt,
    } : null,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
