import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scopePath = path.join(root, "rank_targets_partial_excluding_CA_B0FY6JR3NK.json");
const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
const splitTargets = new Set([
  "US:B0FY67YPSM", "US:B0FY1T38P1", "US:B0FY1RZGZH", "US:B0FY67W88Z", "CA:B0FY6MK2D4", "CA:B0FY6HB74X",
]);
const chunks = scope.targets
  .filter(target => splitTargets.has(`${target.marketplace}:${target.asin}`))
  .flatMap(target => Array.from({ length: 3 }, (_, index) => ({
    marketplace: target.marketplace,
    asin: target.asin,
    start: index * 5,
    end: Math.min((index + 1) * 5, 15),
  })));
if (chunks.length !== 18 || chunks.some(chunk => chunk.end <= chunk.start)) throw new Error(`Unexpected short fragments: ${JSON.stringify(chunks)}`);

const schema = JSON.stringify({
  type: "object",
  properties: { marketplace: { type: "string" }, asin: { type: "string" }, fragment: { type: "file" }, status: { type: "string" }, failure_summary: { type: "string" } },
  required: ["marketplace", "asin", "status", "failure_summary"],
});
const rules = `
Read the declared partial scope file. Find exact target marketplace/ASIN and collect only target keyword indices [start,end); preserve their original text. Do not change rank targets, Listing data, or database, and do not write final Listing output.
Use Sorftime product_traffic_terms for the exact ASIN/site, fetch pages 1-3 as available, NFKC+trim+lowercase exact-match target keywords, latest_organic_position only, and parse Page X Pos Y/Z. 999/page4 only after successful absence.
For each distinct target term make one serial DataForSEO merchant_amazon_products_live_advanced call: US=United States/en_US; CA=Canada/en_CA. Retry transient tool errors <=3. Persistent failure means no fragment output.
Paid metrics require exact data_asin plus type=amazon_paid. Decode URL: sbv_search or sponsored brands video is SBV, other paid PC ad, both minimum rank_absolute; missing eligible result is 999. Never use amazon_serp as paid.
CPR from same response: type amazon_serp, rank_absolute 21-30, nonnegative bought_past_month. >=5 samples means avg=round(mean), cpr=max(1,round(avg/30*8)); otherwise CPR+avg null with true sample count.
Save raw sources under private_spapi_import/four_metrics_raw/<marketplace>-<asin>/. On success write exactly private_spapi_import/four_metrics_fragments/<marketplace>-<asin>-range-<start>-<end>.json with {marketplace,asin,start,end,results}; on failure write none. Return complete/failed with concise failure_summary.
`;
const script = `const chunks = ${JSON.stringify(chunks)};\n` +
`const schema = ${JSON.stringify(schema)};\n` +
`const rules = ${JSON.stringify(rules)};\n` +
`const output = await parallel('补采6个Listing的短关键词分片', () => chunks.map(chunk => agent('Collect one short verified metric fragment: ' + JSON.stringify(chunk) + rules, {brief: '补采 ' + chunk.marketplace + ' ' + chunk.asin + ' 词 ' + String(chunk.start + 1) + '-' + String(chunk.end), schema, input_files: [{path: ${JSON.stringify(scopePath)}, name: 'partial_scope.json'}], effort_level: 'lite'})), {schema});\n` +
`return output;`;
const request = { brief: "补采短关键词分片", script, sandbox: "shared", effort_level: "lite", estimated_agent_calls: chunks.length, max_agent_calls: chunks.length, failure_policy: "collect" };
fs.writeFileSync(path.join(root, "four_metric_short_fragment_workflow_request.json"), `${JSON.stringify(request, null, 2)}\n`);
console.log(JSON.stringify({ chunks, request: path.join(root, "four_metric_short_fragment_workflow_request.json") }, null, 2));
