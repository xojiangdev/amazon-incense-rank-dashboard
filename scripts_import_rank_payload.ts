import fs from "node:fs/promises";
import { applyRealRankSnapshots, type RankSnapshotInput } from "./server/db";

type Payload = { snapshotDate: string; snapshots: RankSnapshotInput[] };
const payload = JSON.parse(await fs.readFile("private_spapi_import/rank_payload_2026-09-21.json", "utf8")) as Payload;
const result = await applyRealRankSnapshots(payload.snapshotDate, payload.snapshots);
console.log(JSON.stringify(result, null, 2));
process.exit(result.updated === payload.snapshots.length ? 0 : 2);
