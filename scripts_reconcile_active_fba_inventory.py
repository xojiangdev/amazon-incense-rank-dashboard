#!/usr/bin/env python3
"""Reconcile every source-declared Active FBA listing to fulfillable inventory.

The seller report is authoritative for Active status and AMAZON_NA fulfillment.
FBA Inventory is queried in explicit seller-SKU batches to avoid incomplete full-feed
pagination and to ensure every eligible report row is checked.
"""
from __future__ import annotations

import csv
import json
import pathlib
import sys
import time
import urllib.parse

from scripts_spapi_collect_us_ca_fba import obtain_token, spapi_json, api_error

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "private_spapi_import"
MARKETS = {
    "US": {"id": "ATVPDKIKX0DER", "currency": "USD", "report": OUT / "us_all_listings_833063020717.tsv", "report_id": "833063020717"},
    "CA": {"id": "A2EUQ1WTGCTBG2", "currency": "CAD", "report": OUT / "ca_all_listings_833064020717.tsv", "report_id": "833064020717"},
}
HOLDER = ["incense holder", "incense stand", "incense tray", "incense plate", "incense dish", "ash catcher", "joss stick holder"]
BURNER = ["incense burner", "backflow", "waterfall incense", "waterfall burner", "censer", "incense fountain"]
STICKS = ["incense stick", "joss stick", "agarbatti", "sandalwood incense", "agarwood incense", "bamboo incense", "stick & coil", "incense coil"]


def classify(row: dict[str, str]) -> str | None:
    # Use title and explicit Amazon category fields only; free-form descriptions often
    # mention a holder as an accessory and can misclassify an incense-stick product.
    text = " ".join([row.get("item-name", ""), row.get("zshop-category1", ""), row.get("zshop-browse-path", "")]).lower()
    if any(term in text for term in HOLDER):
        return "incense_holder"
    if any(term in text for term in BURNER):
        return "incense_burner"
    if any(term in text for term in STICKS):
        return "incense_sticks"
    if "incense" in text and "stick" in text:
        return "incense_sticks"
    return None


def load_rows(file: pathlib.Path) -> list[dict[str, str]]:
    with file.open("r", encoding="utf-8-sig", newline="") as handle:
        return [
            {str(k or "").strip().lower(): str(v or "").strip() for k, v in row.items()}
            for row in csv.DictReader(handle, delimiter="\t")
        ]


def chunked(items: list[str], size: int = 50):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def inventory_for_skus(token: str, marketplace_id: str, skus: list[str]) -> dict[str, dict]:
    inventory: dict[str, dict] = {}
    for batch in chunked(skus, 50):
        params = {
            "details": "true",
            "granularityType": "Marketplace",
            "granularityId": marketplace_id,
            "marketplaceIds": marketplace_id,
            "sellerSkus": ",".join(batch),
        }
        status, payload = spapi_json(token, f"/fba/inventory/v1/summaries?{urllib.parse.urlencode(params)}")
        if status != 200:
            raise api_error(status, payload, "Explicit FBA seller-SKU inventory query")
        for summary in payload.get("payload", {}).get("inventorySummaries", []) or []:
            sku = str(summary.get("sellerSku") or "").strip()
            details = summary.get("inventoryDetails") or {}
            inventory[sku] = {
                "asin": summary.get("asin") or "",
                "product_name": summary.get("productName") or "",
                "fulfillable_quantity": int(details.get("fulfillableQuantity") or 0),
                "total_quantity": int(details.get("totalQuantity") or 0),
                "inbound_working_quantity": int(details.get("inboundWorkingQuantity") or 0),
                "inbound_shipped_quantity": int(details.get("inboundShippedQuantity") or 0),
                "inbound_receiving_quantity": int(details.get("inboundReceivingQuantity") or 0),
                "reserved_quantity": int((details.get("reservedQuantity") or {}).get("totalReservedQuantity") or 0),
                "unfulfillable_quantity": int((details.get("unfulfillableQuantity") or {}).get("totalUnfulfillableQuantity") or 0),
            }
        time.sleep(0.55)
    return inventory


def main() -> int:
    token = obtain_token()
    all_candidates: list[dict] = []
    audit = {"method": "source_report_active_fba_plus_explicit_sku_inventory", "markets": {}}

    for market, config in MARKETS.items():
        rows = load_rows(config["report"])
        active_fba_rows = [
            row for row in rows
            if row.get("status", "").lower() == "active" and row.get("fulfillment-channel", "").upper() == "AMAZON_NA"
        ]
        classified = [(row, classify(row)) for row in active_fba_rows]
        target_rows = [(row, category) for row, category in classified if category]
        non_target_rows = [row for row, category in classified if not category]
        skus = sorted({row.get("seller-sku", "") for row, _ in target_rows if row.get("seller-sku")})
        inventory = inventory_for_skus(token, config["id"], skus)
        market_candidates = []
        no_stock = []
        missing_inventory = []

        for row, category in target_rows:
            sku = row.get("seller-sku", "")
            stock = inventory.get(sku)
            if not stock:
                missing_inventory.append({"sku": sku, "asin": row.get("asin1", ""), "title": row.get("item-name", "")})
                continue
            fulfillable = int(stock.get("fulfillable_quantity") or 0)
            if fulfillable <= 0:
                no_stock.append({
                    "sku": sku,
                    "asin": row.get("asin1", "") or stock.get("asin", ""),
                    "title": row.get("item-name", ""),
                    **stock,
                })
                continue
            candidate = {
                "marketplace": market,
                "asin": row.get("asin1", "") or stock.get("asin", ""),
                "sku": sku,
                "title": row.get("item-name", "") or stock.get("product_name", ""),
                "category": category,
                "category_name": row.get("zshop-category1", "") or row.get("zshop-browse-path", "") or "Incense products",
                "image_url": row.get("image-url", ""),
                "price": row.get("price", ""),
                "currency": config["currency"],
                "fba_stock": fulfillable,
                "fulfillment_channel": "FBA",
                "listing_status": "Active",
                "source_fulfillment_channel": row.get("fulfillment-channel", ""),
                "source_report_id": config["report_id"],
            }
            market_candidates.append(candidate)
            all_candidates.append(candidate)

        audit["markets"][market] = {
            "all_report_rows": len(rows),
            "source_active_fba_rows": len(active_fba_rows),
            "target_active_fba_rows": len(target_rows),
            "non_target_active_fba_rows": len(non_target_rows),
            "target_skus_inventory_queried": len(skus),
            "target_skus_returned_by_inventory": len(inventory),
            "target_active_fba_with_fulfillable_stock": len(market_candidates),
            "target_active_fba_without_fulfillable_stock": len(no_stock),
            "target_active_fba_missing_inventory_summary": len(missing_inventory),
            "no_stock_records": no_stock,
            "missing_inventory_records": missing_inventory,
            "non_target_records": [
                {"sku": row.get("seller-sku", ""), "asin": row.get("asin1", ""), "title": row.get("item-name", "")}
                for row in non_target_rows
            ],
        }
        print(f"[{market}] active FBA={len(active_fba_rows)}, target={len(target_rows)}, with fulfillable stock={len(market_candidates)}", flush=True)

    candidate_path = OUT / "us_ca_target_fba_candidates.json"
    audit_path = OUT / "us_ca_fba_inventory_reconciliation.json"
    candidate_path.write_text(json.dumps(all_candidates, ensure_ascii=False, indent=2), encoding="utf-8")
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"candidate_count": len(all_candidates), "candidate_file": str(candidate_path), "audit_file": str(audit_path), "markets": audit["markets"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
