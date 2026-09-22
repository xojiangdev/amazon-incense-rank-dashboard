import fs from "node:fs";

const sourcePath = "/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import/rank_targets.json";
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const targets = source.map(({ marketplace, asin }) => ({ marketplace, asin }));
const itemSchema = JSON.stringify({
  type: "object",
  properties: {
    marketplace: { type: "string" },
    asin: { type: "string" },
    status: { type: "string" },
    result_file: { type: "file" },
    failure_summary: { type: "string" }
  },
  required: ["marketplace", "asin", "status", "failure_summary"]
});
const finalSchema = JSON.stringify({
  type: "object",
  properties: {
    complete: { type: "boolean" },
    message: { type: "string" },
    audit_file: { type: "file" }
  },
  required: ["complete", "message"]
});
const workerRules = `
For the exact marketplace/ASIN pair below, read the declared file named rank_targets.json and select its sole matching record; that record is the complete keyword target set. Do not change rank_targets.json, Listing data, or the database; never run an importer.

Collect all four metrics under these strict rules:
- Use Sorftime product_traffic_terms for this ASIN and marketplace; fetch pages 1–3 where available. Normalize terms NFKC+trim+lowercase and exact-match only. Use only latest_organic_position. Parse Page X Pos Y/Z as rank=(X-1)*Z+Y, page=X. Use 999/page4 only after successful lookup with no matching phrase.
- For every unique normalized target term make one serial DataForSEO merchant_amazon_products_live_advanced call: US=United States/en_US, CA=Canada/en_CA, JP=Japan/ja_JP. Retry a transient tool error at most 3 times; persistent error fails this Listing without an output file.
- From successful DataForSEO output only, eligible advertising is exact data_asin and type=amazon_paid. Decode URL then classify sbv_search or sponsored brands video as SBV; other paid as ordinary PC ad. Store minimum rank_absolute; no matching eligible type becomes 999. Never count amazon_serp as advertising.
- CPR uses only type=amazon_serp, absolute rank 21–30, nonnegative bought_past_month from the same output. With >=5 samples: average=round(mean), CPR=max(1,round(average/30*8)); otherwise CPR and average are null and sample count remains actual.
- Store raw successful source responses in private_spapi_import/four_metrics_raw/<marketplace>-<asin>/ within the project. Build exactly one valid metric row for every target keyword. On complete success only, write private_spapi_import/four_metrics/<marketplace>-<asin>.json in the required {marketplace,asin,results} shape. On any unverified tool failure do not write it.
Return JSON with status complete/failed and exact concise failure_summary.
`;
const finalRules = `Act as a fail-closed final validator in /home/ubuntu/amazon-incense-rank-dashboard. Never rebuild keywords or modify Listings, reviews, or inventory. Given worker failures, if any failure is reported, write private_spapi_import/four_metrics_validation_failure.json and return complete=false; do not import. If no workers failed, validate every expected file from rank_targets.json: all 42 exist, rows total 370, normalized marketplace+ASIN+keyword keys exactly match, no duplicates/missing/extra, valid rank/sentinel/page fields, and valid CPR null/non-null evidence. On any validation failure write the failure JSON and do not import. Only after full validation, run npx tsx scripts_import_live_four_metrics.ts, then verify four_metrics_import_audit.json reports expected=370 and rank.updated=cpr.updated=ads.updated=370. Return complete=true only then, with audit_file.`;
const script = `const targets = ${JSON.stringify(targets)};\n` +
`const itemSchema = ${JSON.stringify(itemSchema)};\n` +
`const finalSchema = ${JSON.stringify(finalSchema)};\n` +
`const rules = ${JSON.stringify(workerRules)};\n` +
`const collected = await parallel('采集42个Listing四项真实指标', () => targets.map((target) => agent('Collect one Listing four-metric batch: ' + JSON.stringify(target) + rules, {brief: '采集 ' + target.marketplace + ' ' + target.asin + ' 的四项排名', schema: itemSchema, input_files: [{path: ${JSON.stringify(sourcePath)}, name: 'rank_targets.json'}], effort_level: 'lite'})), {schema: itemSchema});\n` +
`const failures = collected.map((result, index) => result.ok && result.value.status === 'complete' ? null : {marketplace: targets[index].marketplace, asin: targets[index].asin, detail: result.ok ? result.value.failure_summary : result.error.message}).filter(Boolean);\n` +
`const final = await agent(${JSON.stringify(finalRules)} + ' Worker failures: ' + JSON.stringify(failures), {brief: '校验并原子导入四项排名指标', schema: finalSchema, input_files: [{path: ${JSON.stringify(sourcePath)}, name: 'rank_targets.json'}], effort_level: 'standard'});\n` +
`return {expectedListings: targets.length, expectedRows: 370, workerFailures: failures, final};`;
const request = { brief: "启动完整四指标恢复采集", script, sandbox: "shared", effort_level: "lite", estimated_agent_calls: 43, max_agent_calls: 43, failure_policy: "collect" };
fs.writeFileSync("private_spapi_import/four_metric_workflow_request.json", JSON.stringify(request, null, 2) + "\n");
console.log(JSON.stringify({ targets: targets.length, expectedRows: source.reduce((n, item) => n + item.keywords.length, 0), requestFile: "private_spapi_import/four_metric_workflow_request.json" }, null, 2));
