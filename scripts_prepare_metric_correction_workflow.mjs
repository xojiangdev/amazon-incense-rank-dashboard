import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scopePath = path.join(root, "rank_targets_urgent_excluding_CA_B0FY6JR3NK_US_B0FY67YPSM.json");
const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
const jobs = [
  { marketplace: "US", asin: "B0GDKDTB6C", id: "a", keywords: ["mugwort incense sticks"] },
  { marketplace: "US", asin: "B0FY6QW1LV", id: "a", keywords: ["￼chinese incense bulk", "chinese joss sticks incense", "incense sticks agarwood", "agarwood incense sticks", "coreless incense"] },
  { marketplace: "US", asin: "B0FY6QW1LV", id: "b", keywords: ["agarwood incense", "coreless incense sticks", "incense coreless", "black agarwood incense", "agarwood incense kit"] },
  { marketplace: "US", asin: "B0FY1T38P1", id: "a", keywords: ["incense burner", "incense holder and storage"] },
  { marketplace: "US", asin: "B0FY1RZGZH", id: "a", keywords: ["glass incense holder", "incense burner holder box", "modern incense holder", "wooden incense holder box", "incense burner box with drawer storage"] },
  { marketplace: "US", asin: "B0FY1RZGZH", id: "b", keywords: ["incense burner holder box black and gold", "glass incense holder tray", "lockable incense burner", "wooden box incense holder", "incense burner with storage"] },
  { marketplace: "US", asin: "B0FY67W88Z", id: "a", keywords: ["incense holder ￼", "incense holder"] },
  { marketplace: "CA", asin: "B0FY6MK2D4", id: "a", keywords: ["natural incense sticks", "mugwort incense non toxic"] },
  { marketplace: "CA", asin: "B0FY6HB74X", id: "a", keywords: ["incense sandalwood", "pine incense sticks", "bakhoor incense sticks", "sandalwood incense sticks"] },
];
for (const job of jobs) {
  const target = scope.targets.find(item => item.marketplace === job.marketplace && item.asin === job.asin);
  if (!target || job.keywords.some(keyword => !target.keywords.includes(keyword))) throw new Error(`Correction job is outside urgent scope: ${JSON.stringify(job)}`);
}
const correctionPlan = {
  status: "targeted_metric_correction_plan",
  scopeFile: path.basename(scopePath),
  jobs,
  correctedKeywords: jobs.reduce((sum, job) => sum + job.keywords.length, 0),
};
fs.writeFileSync(path.join(root, "four_metric_correction_plan.json"), `${JSON.stringify(correctionPlan, null, 2)}\n`);
const schema = JSON.stringify({ type: "object", properties: { marketplace: { type: "string" }, asin: { type: "string" }, status: { type: "string" }, repair_file: { type: "file" }, failure_summary: { type: "string" } }, required: ["marketplace", "asin", "status", "failure_summary"] });
const rules = `
Read the declared urgent scope file. Collect exactly the supplied keywords only; preserve every original character. Do not modify targets, Listing data, or database, and do not run an importer.
For natural ranks, call Sorftime product_traffic_terms for the exact ASIN/site, request available pages 1-3, NFKC+trim+lowercase exact-match only, and use latest_organic_position only. Parse Page X Pos Y/Z. Use 999/page4 only after successful absence.
For each supplied keyword make one serial DataForSEO merchant_amazon_products_live_advanced call (US=United States/en_US; CA=Canada/en_CA); retry a transient tool error no more than three times. Any persistent failure means no repair file.
Only exact data_asin+type=amazon_paid is advertising. Decode URL; sbv_search or sponsored brands video is SBV; other paid is PC ad; take min rank_absolute. A successful absent paid type is 999. Never count amazon_serp as ad.
CPR: same response, type amazon_serp, rank_absolute 21-30, nonnegative bought_past_month. >=5 samples: avg=round(mean), cpr=max(1,round(avg/30*8)); under 5 samples is valid and must write cprEstimate=null/monthlySalesAverage=null with actual cprSampleCount. Do not fail because samples are insufficient.
Save raw source files under private_spapi_import/four_metrics_raw/<marketplace>-<asin>/. Validate output then write exactly private_spapi_import/four_metrics_repairs/<marketplace>-<asin>-<id>.json as {marketplace,asin,id,results:[{marketplace,asin,keyword,naturalRank,page,pcAdRank,pcSbvRank,cprEstimate,monthlySalesAverage,cprSampleCount}]}. On failure write nothing. Return complete/failed and concise failure summary.
`;
const script = `const jobs = ${JSON.stringify(jobs)};\n` +
`const schema = ${JSON.stringify(schema)};\n` +
`const rules = ${JSON.stringify(rules)};\n` +
`const output = await parallel('重采21个缺口和重复映射关键词', () => jobs.map(job => agent('Collect one exact metric correction: ' + JSON.stringify(job) + rules, {brief: '重采 ' + job.marketplace + ' ' + job.asin + ' 的校正关键词', schema, input_files: [{path: ${JSON.stringify(scopePath)}, name: 'urgent_scope.json'}], effort_level: 'lite'})), {schema});\n` +
`return output;`;
const request = { brief: "重采校正关键词", script, sandbox: "shared", effort_level: "lite", estimated_agent_calls: jobs.length, max_agent_calls: jobs.length, failure_policy: "collect" };
fs.writeFileSync(path.join(root, "four_metric_correction_workflow_request.json"), `${JSON.stringify(request, null, 2)}\n`);
console.log(JSON.stringify({ jobs: jobs.length, correctedKeywords: correctionPlan.correctedKeywords, request: path.join(root, "four_metric_correction_workflow_request.json") }, null, 2));
