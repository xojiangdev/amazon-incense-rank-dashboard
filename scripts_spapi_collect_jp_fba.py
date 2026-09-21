#!/usr/bin/env python3
"""Read-only Japan SP-API collector for Active FBA incense listings with sellable stock."""
from __future__ import annotations

import csv
import gzip
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "private_spapi_import"
OUT.mkdir(exist_ok=True)
BASE_URL = "https://sellingpartnerapi-fe.amazon.com"
MARKETPLACE_ID = "A1VC38T7YXB528"

HOLDER = ["incense holder", "incense stand", "incense tray", "ash catcher", "joss stick holder", "香立て", "お香立て", "線香立て", "インセンスホルダー", "灰受け", "香皿"]
BURNER = ["incense burner", "censer", "backflow", "waterfall burner", "香炉", "倒流香", "アロマバーナー"]
STICKS = ["incense sticks", "incense stick", "joss sticks", "joss stick", "agarwood incense", "sandalwood incense", "線香", "お香", "インセンススティック", "スティック香", "棒香", "沈香", "白檀"]
EXCLUDES = ["essential oil", "diffuser oil", "smudge stick", "エッセンシャルオイル", "精油", "ディフューザー", "ホワイトセージバンドル"]


def http_json(url: str, method: str = "GET", headers: dict[str, str] | None = None, body: dict | None = None) -> tuple[int, dict[str, Any]]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:2000]}
        return error.code, payload


def token() -> str:
    required = {name: os.getenv(name) for name in ["SPAPI_JP_CLIENT_ID", "SPAPI_JP_CLIENT_SECRET", "SPAPI_JP_REFRESH_TOKEN"]}
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing Japan SP-API credentials: {', '.join(missing)}")
    form = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": required["SPAPI_JP_REFRESH_TOKEN"],
        "client_id": required["SPAPI_JP_CLIENT_ID"],
        "client_secret": required["SPAPI_JP_CLIENT_SECRET"],
    }).encode("utf-8")
    request = urllib.request.Request("https://api.amazon.com/auth/o2/token", data=form, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return str(payload["access_token"])


def api(access_token: str, path: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict[str, Any]]:
    return http_json(f"{BASE_URL}{path}", method, {"x-amz-access-token": access_token}, body)


def check(status: int, payload: dict[str, Any], action: str):
    if status >= 300:
        raise RuntimeError(f"{action} failed HTTP {status}: {payload.get('errors') or payload}")


def request_report(access_token: str) -> str:
    status, payload = api(access_token, "/reports/2021-06-30/reports", "POST", {
        "reportType": "GET_MERCHANT_LISTINGS_ALL_DATA",
        "marketplaceIds": [MARKETPLACE_ID],
        "reportOptions": {"preferredReportDocumentLocale": "en_US"},
    })
    check(status, payload, "Japan listing report request")
    return str(payload["reportId"])


def wait_report(access_token: str, report_id: str) -> str:
    started = time.monotonic()
    while True:
        status, payload = api(access_token, f"/reports/2021-06-30/reports/{report_id}")
        check(status, payload, "Japan listing report status")
        state = payload.get("processingStatus")
        if state == "DONE":
            return str(payload["reportDocumentId"])
        if state in {"FATAL", "CANCELLED"}:
            raise RuntimeError(f"Japan listing report ended {state}")
        if time.monotonic() - started > 600:
            raise RuntimeError("Japan listing report timed out")
        time.sleep(8)


def download_report(access_token: str, document_id: str) -> str:
    status, payload = api(access_token, f"/reports/2021-06-30/documents/{urllib.parse.quote(document_id, safe='')}")
    check(status, payload, "Japan listing report document")
    with urllib.request.urlopen(payload["url"], timeout=90) as response:
        raw = response.read()
    if payload.get("compressionAlgorithm") == "GZIP":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8-sig", errors="replace")


def parse_rows(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    aliases = {
        "商品名": "item-name",
        "出品者sku": "seller-sku",
        "価格": "price",
        "数量": "quantity",
        "商品id": "asin1",
        "在庫数": "open-date-inventory",
        "フルフィルメント・チャンネル": "fulfillment-channel",
        "ステータス": "status",
    }
    rows: list[dict[str, str]] = []
    for row in reader:
        normalized: dict[str, str] = {}
        for key, value in row.items():
            clean_key = str(key or "").strip().lower()
            normalized[aliases.get(clean_key, clean_key)] = str(value or "").strip()
        if any(normalized.values()):
            rows.append(normalized)
    return rows


def classify(title: str, category: str, browse: str) -> str | None:
    text = f"{title} {category} {browse}".lower()
    if any(term in text for term in EXCLUDES):
        return None
    if any(term in text for term in HOLDER):
        return "incense_holder"
    if any(term in text for term in BURNER):
        return "incense_burner"
    if any(term in text for term in STICKS) or ("incense" in text and "stick" in text):
        return "incense_sticks"
    return None


def batches(values: list[str], size: int = 50):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def inventory_by_sku(access_token: str, skus: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for batch in batches(sorted(set(skus))):
        query = urllib.parse.urlencode({
            "details": "true",
            "granularityType": "Marketplace",
            "granularityId": MARKETPLACE_ID,
            "marketplaceIds": MARKETPLACE_ID,
            "sellerSkus": ",".join(batch),
        })
        status, payload = api(access_token, f"/fba/inventory/v1/summaries?{query}")
        check(status, payload, "Japan explicit SKU FBA inventory")
        for summary in payload.get("payload", {}).get("inventorySummaries", []) or []:
            sku = str(summary.get("sellerSku") or "").strip()
            details = summary.get("inventoryDetails") or {}
            result[sku] = {
                "asin": summary.get("asin") or "",
                "product_name": summary.get("productName") or "",
                "fulfillable_quantity": int(details.get("fulfillableQuantity") or 0),
                "total_quantity": int(details.get("totalQuantity") or 0),
                "inbound_shipped_quantity": int(details.get("inboundShippedQuantity") or 0),
                "reserved_quantity": int((details.get("reservedQuantity") or {}).get("totalReservedQuantity") or 0),
            }
        time.sleep(0.55)
    return result


def main() -> int:
    access_token = token()
    report_id = request_report(access_token)
    print(f"[JP] Waiting for report {report_id}...", flush=True)
    document_id = wait_report(access_token, report_id)
    report_text = download_report(access_token, document_id)
    raw_path = OUT / f"jp_all_listings_{report_id}.tsv"
    raw_path.write_text(report_text, encoding="utf-8")
    rows = parse_rows(report_text)

    active_fba = [row for row in rows if row.get("status", "").lower() == "active" and row.get("fulfillment-channel", "").upper().startswith("AMAZON")]
    classified = [(row, classify(row.get("item-name", ""), row.get("zshop-category1", ""), row.get("zshop-browse-path", ""))) for row in active_fba]
    targets = [(row, category) for row, category in classified if category]
    non_targets = [row for row, category in classified if not category]
    inventory = inventory_by_sku(access_token, [row.get("seller-sku", "") for row, _ in targets if row.get("seller-sku")])

    candidates = []
    zero_stock = []
    missing_inventory = []
    for row, category in targets:
        sku = row.get("seller-sku", "")
        stock = inventory.get(sku)
        if not stock:
            missing_inventory.append({"sku": sku, "asin": row.get("asin1", ""), "title": row.get("item-name", "")})
            continue
        fulfillable = int(stock.get("fulfillable_quantity") or 0)
        if fulfillable <= 0:
            zero_stock.append({"sku": sku, "asin": row.get("asin1", "") or stock.get("asin", ""), "title": row.get("item-name", ""), **stock})
            continue
        candidates.append({
            "marketplace": "JP",
            "asin": row.get("asin1", "") or stock.get("asin", ""),
            "sku": sku,
            "title": row.get("item-name", "") or stock.get("product_name", ""),
            "category": category,
            "category_name": row.get("zshop-category1", "") or row.get("zshop-browse-path", "") or "線香・香炉・香立て",
            "image_url": row.get("image-url", ""),
            "price": row.get("price", ""),
            "currency": "JPY",
            "fba_stock": fulfillable,
            "fulfillment_channel": "FBA",
            "listing_status": "Active",
            "source_fulfillment_channel": row.get("fulfillment-channel", ""),
            "source_report_id": report_id,
        })

    audit = {
        "marketplace": "JP",
        "marketplace_id": MARKETPLACE_ID,
        "report_id": report_id,
        "report_document_id": document_id,
        "all_report_rows": len(rows),
        "source_active_fba_rows": len(active_fba),
        "target_active_fba_rows": len(targets),
        "target_skus_inventory_returned": len(inventory),
        "target_active_fba_with_fulfillable_stock": len(candidates),
        "target_active_fba_without_fulfillable_stock": len(zero_stock),
        "target_active_fba_missing_inventory_summary": len(missing_inventory),
        "non_target_active_fba_rows": len(non_targets),
        "zero_stock_records": zero_stock,
        "missing_inventory_records": missing_inventory,
        "non_target_records": [{"sku": row.get("seller-sku", ""), "asin": row.get("asin1", ""), "title": row.get("item-name", "")} for row in non_targets],
        "raw_report_file": str(raw_path),
    }
    (OUT / "jp_target_fba_candidates.json").write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "jp_fba_inventory_reconciliation.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"candidate_count": len(candidates), "audit": audit}, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr, flush=True)
        sys.exit(1)
