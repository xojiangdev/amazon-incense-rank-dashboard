import fs from "node:fs/promises";
import { getRankTrackingTargets } from "./server/db";

const targets = await getRankTrackingTargets();
await fs.writeFile("private_spapi_import/rank_targets.json", JSON.stringify(targets, null, 2));
console.log(JSON.stringify({ listings: targets.length, keywords: targets.reduce((sum, item) => sum + item.keywords.length, 0) }));
process.exit(0);
