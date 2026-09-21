// Multi-agent workflow to collect desktop SERP items for target keywords via DataForSEO in parallel
const fs = require("fs");
const targets = JSON.parse(fs.readFileSync("/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import/desktop_serp_workflow_targets.json", "utf8"));

log(`Starting workflow for ${targets.length} target keyword groups...`);

// Group targets into batches of 15 to stay within limits
const BATCH_SIZE = 15;
const batches = [];
for (let i = 0; i < targets.length; i += BATCH_SIZE) {
  batches.push(targets.slice(i, i + BATCH_SIZE));
}

return {
  status: "ready",
  totalBatches: batches.length,
  totalKeywords: targets.length,
};
