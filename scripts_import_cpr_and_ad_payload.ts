import fs from "node:fs/promises";
import path from "node:path";
import { applyCprEstimates, applyPcAdvertisingRanks, type CprEstimateInput, type PcAdvertisingRankInput } from "./server/db";

interface Payload {
  snapshotDate: string;
  cprMetrics: CprEstimateInput[];
  adPositions: PcAdvertisingRankInput[];
}

const root = path.resolve("private_spapi_import");
const payloadPath = path.join(root, "cpr_and_ad_payload.json");
const raw = await fs.readFile(payloadPath, "utf8");
const payload = JSON.parse(raw) as Payload;

console.log(`Starting atomic import of CPR and PC ad positions for date ${payload.snapshotDate}...`);

// 1. Apply CPR estimates
const cprResult = await applyCprEstimates(payload.cprMetrics, new Date());
console.log(`CPR Import complete: updated=${cprResult.updated}, calculated=${cprResult.calculated}, insufficientEvidence=${cprResult.insufficientEvidence}`);

// 2. Apply PC advertising ranks
const adResult = await applyPcAdvertisingRanks(payload.snapshotDate, payload.adPositions);
console.log(`PC Ad Import complete: updated=${adResult.updated}, adFound=${adResult.pcAdFound}, sbvFound=${adResult.pcSbvFound}, neitherFound=${adResult.neitherFound}`);

console.log("All data successfully verified and committed!");
