#!/usr/bin/env python3
"""Read-only SP-API collector for active FBA listings in Amazon US and Canada.

It requests one ALL LISTINGS report per marketplace (required by Amazon), joins the
reports to FBA Inventory summaries by seller SKU, and writes auditable private files.
No Seller Central listing, inventory, price, or advertising data is changed.
"""
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
from dataclasses import dataclass
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent
OUT_DIR = ROOT / "private_spapi_import"
OUT_DIR.mkdir(exist_ok=True)

BASE_URL = "https://sellingpartnerapi-na.amazon.com"
MARKETPLACES = {
    "US": {"id": "ATVPDKIKX0DER", "locale": "en_US", "currency": "USD"},
    "CA": {"id": "A2EUQ1WTGCTBG2", "locale": "en_CA", "currency": "CAD"},
}

INCENSE_BURNER_TERMS = [
    "incense burner", "backflow", "waterfall burner", "waterfall incense", "censer",
    "bruleur d'encens", "encensoir", "aromatherapy burner", "incense fountain",
]
INCENSE_HOLDER_TERMS = [
    "incense holder", "incense stick holder", "ash catcher", "incense tray", "incense plate",
    "incense stand", "incense dish", "joss stick holder", "porte-encens", "support d'encens",
]
INCENSE_STICK_TERMS = [
    "incense sticks", "incense stick", "agarbatti", "joss sticks", "joss stick", "sandalwood incense",
    "agarwood incense", "fragrance sticks", "bamboo incense", "smudge incense",
]


@dataclass(frozen=True)
class ListingCandidate:
    marketplace: str
    asin: str
    sku: str
    title: str
    category: str
    category_name: str
    image_url: str
    price: str
    currency: str
    fba_stock: int
    fulfillment_channel: str
    listing_status: str
    source_report_id: str


def http_json(url: str, method: str = "GET", headers: dict[str, str] | None = None, json_body: dict | None = None) -> tuple[int, dict[str, Any]]:
    request_headers = {"Accept": "application/json", **(headers or {})}
    body = None
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:2000]}
        return err.code, payload


def obtain_token() -> str:
    required = {k: os.getenv(k) for k in ["SPAPI_CLIENT_ID", "SPAPI_CLIENT_SECRET", "SPAPI_REFRESH_TOKEN"]}
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing North America SP-API credentials: {', '.join(missing)}")
    form = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": required["SPAPI_REFRESH_TOKEN"],
        "client_id": required["SPAPI_CLIENT_ID"],
        "client_secret": required["SPAPI_CLIENT_SECRET"],
    }).encode("utf-8")
    request = urllib.request.Request("https://api.amazon.com/auth/o2/token", data=form, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("LWA token exchange returned no access token")
    return token


def spapi_json(token: str, path: str, method: str = "GET", json_body: dict | None = None) -> tuple[int, dict[str, Any]]:
    return http_json(f"{BASE_URL}{path}", method=method, headers={"x-amz-access-token": token}, json_body=json_body)


def api_error(status: int, payload: dict[str, Any], action: str) -> RuntimeError:
    message = payload.get("errors") or payload.get("message") or payload.get("error") or payload.get("raw")
    return RuntimeError(f"{action} failed with HTTP {status}: {message}")


def collect_fba_inventory(token: str, marketplace_id: str) -> dict[str, dict[str, Any]]:
    """Return FBA inventory keyed by seller SKU. FBA Inventory API itself excludes FBM stock."""
    inventory: dict[str, dict[str, Any]] = {}
    next_token: str | None = None
    page_count = 0
    while True:
        if next_token:
            query = urllib.parse.urlencode({"nextToken": next_token})
        else:
            query = urllib.parse.urlencode({
                "details": "true",
                "granularityType": "Marketplace",
                "granularityId": marketplace_id,
                "marketplaceIds": marketplace_id,
            })
        status, payload = spapi_json(token, f"/fba/inventory/v1/summaries?{query}")
        if status != 200:
            raise api_error(status, payload, "FBA inventory summary retrieval")
        page = payload.get("payload", {})
        for summary in page.get("inventorySummaries", []) or []:
            sku = str(summary.get("sellerSku") or "").strip()
            if not sku:
                continue
            details = summary.get("inventoryDetails") or {}
            inventory[sku] = {
                "asin": summary.get("asin") or "",
                "product_name": summary.get("productName") or "",
                "fulfillable_quantity": int(details.get("fulfillableQuantity") or 0),
                "total_quantity": int(details.get("totalQuantity") or 0),
                "reserved_quantity": int(details.get("reservedQuantity", {}).get("totalReservedQuantity") or 0),
            }
        page_count += 1
        next_token = page.get("nextToken")
        if not next_token:
            break
        # Amazon expires pagination tokens after 30 seconds; move immediately but avoid burst use.
        time.sleep(0.55)
    return inventory


def request_listing_report(token: str, marketplace_id: str, locale: str) -> str:
    body = {
        "reportType": "GET_MERCHANT_LISTINGS_ALL_DATA",
        "marketplaceIds": [marketplace_id],
        "reportOptions": {"preferredReportDocumentLocale": locale},
    }
    status, payload = spapi_json(token, "/reports/2021-06-30/reports", method="POST", json_body=body)
    if status != 202:
        raise api_error(status, payload, "Active/all listings report request")
    report_id = payload.get("reportId")
    if not report_id:
        raise RuntimeError("Report request completed without reportId")
    return str(report_id)


def wait_for_report(token: str, report_id: str, max_wait_seconds: int = 420) -> str:
    started = time.monotonic()
    while True:
        status, payload = spapi_json(token, f"/reports/2021-06-30/reports/{urllib.parse.quote(report_id, safe='')}")
        if status != 200:
            raise api_error(status, payload, "Report status retrieval")
        processing_status = payload.get("processingStatus")
        if processing_status == "DONE":
            document_id = payload.get("reportDocumentId")
            if not document_id:
                raise RuntimeError(f"Report {report_id} is DONE but has no reportDocumentId")
            return str(document_id)
        if processing_status in {"CANCELLED", "FATAL"}:
            raise RuntimeError(f"Report {report_id} completed with {processing_status}")
        if time.monotonic() - started > max_wait_seconds:
            raise RuntimeError(f"Report {report_id} did not finish within {max_wait_seconds} seconds")
        time.sleep(8)


def download_report_document(token: str, document_id: str) -> str:
    path = f"/reports/2021-06-30/documents/{urllib.parse.quote(document_id, safe='')}"
    status, payload = spapi_json(token, path)
    if status != 200:
        raise api_error(status, payload, "Report document lookup")
    url = payload.get("url")
    if not url:
        raise RuntimeError("Report document response contained no download URL")
    with urllib.request.urlopen(url, timeout=60) as response:
        raw = response.read()
    if payload.get("compressionAlgorithm") == "GZIP":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8-sig", errors="replace")


def parse_rows(report_text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(report_text), delimiter="\t")
    rows: list[dict[str, str]] = []
    for raw_row in reader:
        normalized = {str(key or "").strip().lower(): str(value or "").strip() for key, value in raw_row.items()}
        if any(normalized.values()):
            rows.append(normalized)
    return rows


def classify_target(title: str, category: str, browse_path: str) -> str | None:
    text = f"{title} {category} {browse_path}".lower()
    if any(term in text for term in INCENSE_HOLDER_TERMS):
        return "incense_holder"
    if any(term in text for term in INCENSE_BURNER_TERMS):
        return "incense_burner"
    if any(term in text for term in INCENSE_STICK_TERMS):
        return "incense_sticks"
    if "incense" in text and "stick" in text:
        return "incense_sticks"
    return None


def parse_int(value: str) -> int:
    try:
        return int(float(value.replace(",", "")))
    except (ValueError, AttributeError):
        return 0


def source_listing_status(row: dict[str, str]) -> str:
    return row.get("status") or row.get("listing status") or row.get("add-delete") or ""


def get_fba_candidates(marketplace: str, config: dict[str, str], report_rows: list[dict[str, str]], fba_inventory: dict[str, dict[str, Any]], report_id: str) -> tuple[list[ListingCandidate], dict[str, int], list[dict[str, str]]]:
    candidates: list[ListingCandidate] = []
    excluded: list[dict[str, str]] = []
    active_count = 0
    fba_match_count = 0

    for row in report_rows:
        sku = row.get("seller-sku", "").strip()
        asin = row.get("asin1", "").strip()
        title = row.get("item-name", "").strip()
        status = source_listing_status(row)
        is_active = status.lower() == "active"
        if not is_active:
            continue
        active_count += 1
        inventory = fba_inventory.get(sku)
        if not inventory:
            continue
        fba_match_count += 1
        category_name = row.get("zshop-category1", "").strip()
        browse_path = row.get("zshop-browse-path", "").strip()
        category = classify_target(title, category_name, browse_path)
        if not category:
            excluded.append({
                "marketplace": marketplace,
                "sku": sku,
                "asin": asin,
                "title": title,
                "reason": "FBA active listing outside target incense category",
            })
            continue
        candidates.append(ListingCandidate(
            marketplace=marketplace,
            asin=asin or str(inventory.get("asin") or ""),
            sku=sku,
            title=title or str(inventory.get("product_name") or sku),
            category=category,
            category_name=category_name or browse_path or "Incense products",
            image_url=row.get("image-url", "").strip(),
            price=row.get("price", "").strip(),
            currency=config["currency"],
            fba_stock=int(inventory.get("fulfillable_quantity") or 0),
            fulfillment_channel="FBA",
            listing_status=status,
            source_report_id=report_id,
        ))

    summary = {
        "report_rows": len(report_rows),
        "active_listing_rows": active_count,
        "fba_inventory_skus": len(fba_inventory),
        "active_fba_matches": fba_match_count,
        "target_candidates": len(candidates),
        "excluded_non_target_fba_active": len(excluded),
    }
    return candidates, summary, excluded


def main() -> int:
    token = obtain_token()
    all_candidates: list[ListingCandidate] = []
    summary: dict[str, Any] = {"run_type": "read_only_source_collection", "markets": {}}
    excluded_records: list[dict[str, str]] = []

    for market, config in MARKETPLACES.items():
        print(f"[{market}] Collecting FBA Inventory summaries...", flush=True)
        fba_inventory = collect_fba_inventory(token, config["id"])
        print(f"[{market}] Requesting detailed all-listings report...", flush=True)
        report_id = request_listing_report(token, config["id"], config["locale"])
        print(f"[{market}] Waiting for report {report_id}...", flush=True)
        document_id = wait_for_report(token, report_id)
        report_text = download_report_document(token, document_id)
        report_path = OUT_DIR / f"{market.lower()}_all_listings_{report_id}.tsv"
        report_path.write_text(report_text, encoding="utf-8")
        rows = parse_rows(report_text)
        candidates, market_summary, excluded = get_fba_candidates(market, config, rows, fba_inventory, report_id)
        summary["markets"][market] = {**market_summary, "report_id": report_id, "report_document_id": document_id, "raw_report_file": str(report_path)}
        all_candidates.extend(candidates)
        excluded_records.extend(excluded)
        print(f"[{market}] Found {len(candidates)} target FBA-active candidates from {len(rows)} report rows.", flush=True)

    normalized = [candidate.__dict__ for candidate in all_candidates]
    (OUT_DIR / "us_ca_target_fba_candidates.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "us_ca_excluded_fba_active_audit.json").write_text(json.dumps(excluded_records, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "us_ca_source_collection_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc), "run_type": "read_only_source_collection"}, ensure_ascii=False), file=sys.stderr, flush=True)
        sys.exit(1)
