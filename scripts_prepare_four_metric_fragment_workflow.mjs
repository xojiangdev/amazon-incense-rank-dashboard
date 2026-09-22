import fs from "node:fs";
import path from "node:path";

const root = path.resolve("private_spapi_import");
const scopePath = path.join(root, "rank_targets_partial_excluding_CA_B0FY6JR3NK.json");
const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
const incomplete = new Set([
  "US:B0GDKDTB6C", "US:B0GZDQPWFN", "US:B0GZDN4VR8", "US:B0FY6QW1LV", "US:B0FY67YPSM", "US:B0FY1T38P1",
  "US:B0FY1RZGZH", "US:B0FY67W88Z", "US:B0FY6MK2D4", "CA:B0FY67W88Z", "CA:B0FY6MK2D4", "CA:B0FY6HB74X",
]);
const maxTerms = 15;
const chunks = scope.targets
  .filter(target => incomplete.has(`${target.marketplace}:${target.asin}`))
  .flatMap(target => Array.from({ length: Math.ceil(target.keywords.length / maxTerms) }, (_, index) => ({
    marketplace: target.marketplace,
    asin: target.asin,
    index,
    start: index * maxTerms,
    end: Math.min((index + 1) * maxTerms, target.keywords.length),
  })));
if (chunks.length !== 19) throw new Error(`Expected 19 fragment jobs, found ${chunks.length}`);

const schema = JSON.stringify({
  type: "object",
  properties: { marketplace: { type: "string" }, asin: { type: "string" }, fragment: { type: "file" }, status: { type: "string" }, failure_summary: { type: "string" } },
  required: ["marketplace", "asin", "status", "failure_summary"],
});
const rules = `
Read the declared partial scope file. Find the exact marketplace/ASIN target and collect only keywords indexed [start,end); preserve their original text. This is a fragment recovery: do not alter rank targets, listing data, or the database, and do not write a final Listing output file.

For the chunk's natural position: call Sorftime product_traffic_terms for the exact ASIN and marketplace, fetch available pages 1-3, normalize NFKC+trim+lowercase and exact-match only, use only latest_organic_position, and parse Page X Pos Y/Z into rank/page. Use 999/page4 only when a successful lookup does not contain a target phrase.
For every distinct normalized chunk keyword call DataForSEO merchant_amazon_products_live_advanced serially, with US=United States/en_US and CA=Canada/en_CA. Retry only transient tool errors up to 3 times; any persistent tool failure makes this fragment fail with no fragment output.
Advertising: exact data_asin plus type=amazon_paid only. Decode URL then SBV means sbv_search or sponsored brands video; other paid is PC ad. Use min rank_absolute. Missing type in successful result is 999. Do not count amazon_serp as paid.
CPR: same successful response only, type amazon_serp, rank_absolute 21-30, nonnegative bought_past_month. With >=5 samples calculate round(mean) and max(1,round(avg/30*8)); otherwise CPR and avg are null while keeping sample count.
Save each successful source raw response to private_spapi_import/four_metrics_raw/<marketplace>-<asin>/ (stable filenames allowed). Validate all fragment rows. On whole fragment success write private_spapi_import/four_metrics_fragments/<marketplace>-<asin>-<index>.json as {marketplace,asin,index,results:[...]}. On failure do not write a fragment. Return complete/failed with a concise exact failure summary.
`;
const script = `const chunks = ${JSON.stringify(chunks)};\n` +
`const schema = ${JSON.stringify(schema)};\n` +
`const rules = ${JSON.stringify(rules)};\n` +
`const output = await parallel('补采12个未完成Listing的指标分片', () => chunks.map(chunk => agent('Collect one exact four-metric fragment: ' + JSON.stringify(chunk) + rules, {brief: '补采 ' + chunk.marketplace + ' ' + chunk.asin + ' 关键词分片 ' + String(chunk.index + 1), schema, input_files: [{path: ${JSON.stringify(scopePath)}, name: 'partial_scope.json'}], effort_level: 'lite'})), {schema});\n` +
`return output;`;
const request = { brief: "补采未完成Listing的四项指标分片", script, sandbox: "shared", effort_level: "lite", estimated_agent_calls: chunks.length, max_agent_calls: chunks.length, failure_policy: "collect" };
fs.writeFileSync(path.join(root, "four_metric_fragment_workflow_request.json"), `${JSON.stringify(request, null, 2)}\n`);
console.log(JSON.stringify({ chunks, request: path.join(root, "four_metric_fragment_workflow_request.json") }, null, 2));
