#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TARGETS = ROOT / "private_spapi_import" / "rank_targets.json"
RESULTS = ROOT / "private_spapi_import" / "rank_results_2026-09-21.jsonl"
PAYLOAD = ROOT / "private_spapi_import" / "rank_payload_2026-09-21.json"

targets = json.loads(TARGETS.read_text(encoding="utf-8"))
expected = [(item["marketplace"], item["asin"], keyword.strip().lower()) for item in targets for keyword in item["keywords"]]
rows = [json.loads(line) for line in RESULTS.read_text(encoding="utf-8").splitlines() if line.strip()]
actual = [(row["marketplace"], row["asin"], row["keyword"].strip().lower()) for row in rows]

expected_counter = Counter(expected)
actual_counter = Counter(actual)
missing = list((expected_counter - actual_counter).elements())
extra = list((actual_counter - expected_counter).elements())
duplicates = [key for key, count in actual_counter.items() if count > 1]
invalid = [row for row in rows if not isinstance(row.get("rank"), int) or not 1 <= row["rank"] <= 999 or row.get("page") not in (1, 2, 3, 4)]

summary = {
    "expected": len(expected),
    "actual": len(rows),
    "missing": len(missing),
    "extra": len(extra),
    "duplicates": len(duplicates),
    "invalid": len(invalid),
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
if missing or extra or duplicates or invalid:
    print(json.dumps({"missing": missing[:20], "extra": extra[:20], "duplicates": duplicates[:20], "invalid": invalid[:20]}, ensure_ascii=False, indent=2))
    raise SystemExit(2)

snapshot_date = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
payload = {"snapshotDate": snapshot_date, "snapshots": rows}
PAYLOAD.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
print(str(PAYLOAD))
