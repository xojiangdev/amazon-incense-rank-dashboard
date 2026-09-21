import fs from "node:fs/promises";
import path from "node:path";
import { applyProductReviewMetrics, type ProductReviewMetricInput } from "./server/db";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const inputPath = process.argv[2] || path.join(root, "private_spapi_import", "product_metrics_latest.json");

type InputPayload = {
  observedAt: string;
  metrics: ProductReviewMetricInput[];
};

const payload = JSON.parse(await fs.readFile(inputPath, "utf8")) as InputPayload;
const observedAt = new Date(payload.observedAt);
if (Number.isNaN(observedAt.getTime())) throw new Error("Invalid observedAt timestamp");
if (!Array.isArray(payload.metrics) || payload.metrics.length === 0) throw new Error("Metrics batch is empty");
for (const metric of payload.metrics) {
  if (!(["US", "CA", "JP"] as const).includes(metric.marketplace)) throw new Error(`Invalid marketplace: ${metric.marketplace}`);
  if (!/^[A-Z0-9]{10}$/.test(metric.asin)) throw new Error(`Invalid ASIN: ${metric.asin}`);
  if (metric.rating !== null && (metric.rating < 0 || metric.rating > 5)) throw new Error(`Invalid rating for ${metric.asin}`);
  if (metric.reviewCount !== null && (!Number.isInteger(metric.reviewCount) || metric.reviewCount < 0)) throw new Error(`Invalid review count for ${metric.asin}`);
  if (!metric.source) throw new Error(`Missing metric source for ${metric.asin}`);
}

const result = await applyProductReviewMetrics(payload.metrics, observedAt);
console.log(JSON.stringify({ inputPath, observedAt: observedAt.toISOString(), ...result }, null, 2));
