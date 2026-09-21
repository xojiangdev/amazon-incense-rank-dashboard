#!/usr/bin/env python3
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
target_path = root / "private_spapi_import" / "product_metric_targets.json"
results_path = root / "private_spapi_import" / "product_metrics_results.jsonl"
output_path = root / "private_spapi_import" / "product_metrics_latest.json"

targets = json.loads(target_path.read_text(encoding="utf-8"))
metrics = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]

def key(row):
    return f"{row['marketplace']}::{row['asin']}"

expected = {key(row) for row in targets}
actual_keys = [key(row) for row in metrics]
actual = set(actual_keys)
duplicates = sorted(k for k, count in Counter(actual_keys).items() if count > 1)
missing = sorted(expected - actual)
extra = sorted(actual - expected)
invalid = []
for row in metrics:
    rating = row.get("rating")
    count = row.get("reviewCount")
    if row.get("source") != "sorftime_product_detail":
        invalid.append(f"{key(row)}:invalid_source")
    if rating is not None and (not isinstance(rating, (int, float)) or rating < 0 or rating > 5):
        invalid.append(f"{key(row)}:invalid_rating")
    if count is not None and (not isinstance(count, int) or count < 0):
        invalid.append(f"{key(row)}:invalid_review_count")

summary = {
    "expected": len(expected),
    "actual": len(metrics),
    "unique": len(actual),
    "duplicates": duplicates,
    "missing": missing,
    "extra": extra,
    "invalid": invalid,
}
if duplicates or missing or extra or invalid or len(metrics) != len(expected):
    raise SystemExit(json.dumps(summary, ensure_ascii=False, indent=2))

observed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
payload = {"observedAt": observed_at, "metrics": metrics}
output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
with_rating = [row for row in metrics if (row.get("reviewCount") or 0) > 0]
summary.update({
    "observedAt": observed_at,
    "withRating": len(with_rating),
    "noRating": len(metrics) - len(with_rating),
    "averageRating": round(sum(float(row["rating"]) for row in with_rating) / len(with_rating), 2) if with_rating else None,
    "reviewCountTotal": sum(int(row["reviewCount"]) for row in with_rating),
    "output": str(output_path),
})
print(json.dumps(summary, ensure_ascii=False, indent=2))
