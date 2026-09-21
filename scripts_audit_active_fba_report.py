#!/usr/bin/env python3
"""Audit seller reports using Amazon's source fulfillment-channel field.
No external calls or mutations; prints only listing audit data.
"""
from __future__ import annotations

import csv
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent / "private_spapi_import"
REPORTS = {
    "US": ROOT / "us_all_listings_833063020717.tsv",
    "CA": ROOT / "ca_all_listings_833064020717.tsv",
}

# High-recall classification for the user's specific scope. Human-readable audit output
# is produced so ambiguous items can be rejected before database import.
HOLDER = ["incense holder", "incense stand", "incense tray", "incense plate", "incense dish", "ash catcher", "joss stick holder"]
BURNER = ["incense burner", "backflow", "waterfall incense", "waterfall burner", "censer", "incense fountain"]
STICK_SIGNALS = ["incense stick", "joss stick", "agarbatti", "sandalwood incense", "agarwood incense", "bamboo incense", "stick & coil", "incense coil"]


def classify(row: dict[str, str]) -> str | None:
    text = " ".join([row.get("item-name", ""), row.get("item-description", ""), row.get("zshop-category1", ""), row.get("zshop-browse-path", "")]).lower()
    if any(term in text for term in BURNER):
        return "incense_burner"
    if any(term in text for term in HOLDER):
        return "incense_holder"
    if any(term in text for term in STICK_SIGNALS):
        return "incense_sticks"
    return None


def rows(file: pathlib.Path) -> list[dict[str, str]]:
    with file.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        return [{str(k or "").strip().lower(): str(v or "").strip() for k, v in row.items()} for row in reader]


def main():
    result = {}
    for marketplace, report_path in REPORTS.items():
        report_rows = rows(report_path)
        active_fba = [
            row for row in report_rows
            if row.get("status", "").lower() == "active" and row.get("fulfillment-channel", "").upper() == "AMAZON_NA"
        ]
        records = [
            {
                "marketplace": marketplace,
                "asin": row.get("asin1", ""),
                "sku": row.get("seller-sku", ""),
                "title": row.get("item-name", ""),
                "source_fulfillment_channel": row.get("fulfillment-channel", ""),
                "status": row.get("status", ""),
                "category": classify(row),
            }
            for row in active_fba
        ]
        result[marketplace] = {
            "all_report_rows": len(report_rows),
            "active_source_fba_rows": len(active_fba),
            "target_classified_rows": sum(1 for row in records if row["category"]),
            "records": records,
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
