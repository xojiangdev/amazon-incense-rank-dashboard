#!/usr/bin/env python3
"""Collect official Search Query Performance by ASIN reports for imported US/CA products.

Read-only SP-API operation. Uses the last complete calendar month and writes raw and
normalized report data. The 200-character ASIN option limit is respected by batching.
"""
from __future__ import annotations

import gzip
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

from scripts_spapi_collect_us_ca_fba import obtain_token, spapi_json, api_error

ROOT = pathlib.Path(__file__).resolve().parent
PRIVATE = ROOT / "private_spapi_import"
CANDIDATES = PRIVATE / "us_ca_target_fba_candidates.json"
MARKETS = {"US": "ATVPDKIKX0DER", "CA": "A2EUQ1WTGCTBG2"}
REPORT_TYPE = "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT"
START_DATE = "2026-08-01"
END_DATE = "2026-08-31"


def batch_asins(asins: list[str], max_chars: int = 200) -> list[list[str]]:
    batches: list[list[str]] = []
    current: list[str] = []
    length = 0
    for asin in sorted(set(asins)):
        extra = len(asin) + (1 if current else 0)
        if current and length + extra > max_chars:
            batches.append(current)
            current = []
            length = 0
        current.append(asin)
        length += extra
    if current:
        batches.append(current)
    return batches


def create_report(token: str, marketplace_id: str, asins: list[str]) -> str:
    body = {
        "reportType": REPORT_TYPE,
        "dataStartTime": START_DATE,
        "dataEndTime": END_DATE,
        "marketplaceIds": [marketplace_id],
        "reportOptions": {"asin": " ".join(asins), "reportPeriod": "MONTH"},
    }
    status, payload = spapi_json(token, "/reports/2021-06-30/reports", method="POST", json_body=body)
    if status != 202:
        raise api_error(status, payload, f"SQP report request for {','.join(asins)}")
    return str(payload["reportId"])


def wait_report(token: str, report_id: str, max_wait_seconds: int = 600) -> str:
    started = time.monotonic()
    while True:
        status, payload = spapi_json(token, f"/reports/2021-06-30/reports/{urllib.parse.quote(report_id, safe='')}")
        if status != 200:
            raise api_error(status, payload, "SQP report status")
        processing = payload.get("processingStatus")
        if processing == "DONE":
            document_id = payload.get("reportDocumentId")
            if not document_id:
                raise RuntimeError(f"SQP report {report_id} done without document ID")
            return str(document_id)
        if processing in {"CANCELLED", "FATAL"}:
            raise RuntimeError(f"SQP report {report_id} ended with {processing}")
        if time.monotonic() - started > max_wait_seconds:
            raise RuntimeError(f"SQP report {report_id} exceeded {max_wait_seconds}s")
        time.sleep(10)


def download_json(token: str, document_id: str) -> dict:
    status, payload = spapi_json(token, f"/reports/2021-06-30/documents/{urllib.parse.quote(document_id, safe='')}")
    if status != 200:
        raise api_error(status, payload, "SQP report document lookup")
    with urllib.request.urlopen(payload["url"], timeout=90) as response:
        raw = response.read()
    if payload.get("compressionAlgorithm") == "GZIP":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8-sig"))


def normalize_item(item: dict, marketplace: str) -> dict:
    query = item.get("searchQueryData") or {}
    impressions = item.get("impressionData") or {}
    clicks = item.get("clickData") or {}
    carts = item.get("cartAddData") or {}
    purchases = item.get("purchaseData") or {}
    asin_clicks = int(clicks.get("asinClickCount") or 0)
    asin_purchases = int(purchases.get("asinPurchaseCount") or 0)
    return {
        "marketplace": marketplace,
        "asin": item.get("asin") or "",
        "search_query": str(query.get("searchQuery") or "").strip(),
        "search_query_score": int(query.get("searchQueryScore") or 0),
        "search_query_volume": int(query.get("searchQueryVolume") or 0),
        "asin_impression_count": int(impressions.get("asinImpressionCount") or 0),
        "asin_click_count": asin_clicks,
        "asin_cart_add_count": int(carts.get("asinCartAddCount") or 0),
        "asin_purchase_count": asin_purchases,
        "asin_conversion_rate": round((asin_purchases / asin_clicks * 100), 2) if asin_clicks else 0.0,
        "asin_purchase_share": float(purchases.get("asinPurchaseShare") or 0),
        "start_date": item.get("startDate") or START_DATE,
        "end_date": item.get("endDate") or END_DATE,
    }


def main() -> int:
    candidates = json.loads(CANDIDATES.read_text(encoding="utf-8"))
    grouped: dict[str, list[str]] = defaultdict(list)
    for item in candidates:
        grouped[item["marketplace"]].append(item["asin"])

    token = obtain_token()
    pending: list[dict] = []
    for marketplace in ["US", "CA"]:
        for batch_no, batch in enumerate(batch_asins(grouped[marketplace]), start=1):
            print(f"[{marketplace}] Requesting SQP batch {batch_no}: {len(batch)} ASINs", flush=True)
            report_id = create_report(token, MARKETS[marketplace], batch)
            pending.append({"marketplace": marketplace, "batch_no": batch_no, "asins": batch, "report_id": report_id})
            time.sleep(0.5)

    normalized: list[dict] = []
    manifest = []
    for task in pending:
        print(f"[{task['marketplace']}] Waiting for SQP report {task['report_id']}...", flush=True)
        document_id = wait_report(token, task["report_id"])
        document = download_json(token, document_id)
        raw_path = PRIVATE / f"sqp_{task['marketplace'].lower()}_{task['report_id']}.json"
        raw_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
        rows = [normalize_item(item, task["marketplace"]) for item in document.get("dataByAsin", [])]
        normalized.extend(row for row in rows if row["asin"] and row["search_query"])
        manifest.append({**task, "document_id": document_id, "row_count": len(rows), "raw_file": str(raw_path)})
        print(f"[{task['marketplace']}] Report {task['report_id']} yielded {len(rows)} query rows", flush=True)

    normalized_path = PRIVATE / "us_ca_sqp_normalized.json"
    manifest_path = PRIVATE / "us_ca_sqp_manifest.json"
    normalized_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    by_market = {market: sum(1 for row in normalized if row["marketplace"] == market) for market in MARKETS}
    asins_with_data = {market: len({row["asin"] for row in normalized if row["marketplace"] == market}) for market in MARKETS}
    print(json.dumps({"query_rows": len(normalized), "by_market": by_market, "asins_with_data": asins_with_data, "normalized_file": str(normalized_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr, flush=True)
        sys.exit(1)
