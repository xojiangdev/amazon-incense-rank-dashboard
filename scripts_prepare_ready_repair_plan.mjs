import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const plan = JSON.parse(fs.readFileSync(path.join(root, "four_metric_correction_plan.json"), "utf8"));
const omitted = new Set(["US:B0FY67W88Z:a"]);
const jobs = plan.jobs.filter(job => !omitted.has(`${job.marketplace}:${job.asin}:${job.id}`));
const output = { ...plan, status: "ready_metric_correction_plan", jobs, correctedKeywords: jobs.reduce((sum, job) => sum + job.keywords.length, 0), omitted: [{ marketplace: "US", asin: "B0FY67W88Z", id: "a", reason: "Repair failed closed; its Listing is excluded from the ready scope" }] };
if (jobs.length !== 8 || output.correctedKeywords !== 29) throw new Error(`Unexpected ready repair plan: jobs=${jobs.length}, keywords=${output.correctedKeywords}`);
const outputPath = path.join(root, "four_metric_ready_correction_plan.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, jobs: jobs.length, correctedKeywords: output.correctedKeywords }, null, 2));
