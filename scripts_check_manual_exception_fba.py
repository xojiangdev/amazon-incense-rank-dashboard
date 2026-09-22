#!/usr/bin/env python3
"""Read-only FBA eligibility check for explicitly approved manual category exceptions."""
from __future__ import annotations

import json
import urllib.parse

from scripts_spapi_collect_us_ca_fba import obtain_token, spapi_json

MARKETPLACE_ID = "ATVPDKIKX0DER"
REQUESTED = {
    "B0H3J6LR1K": "S1-WEYZ-1LN0",
    "B0HJ1GPC2S": "Sleeping Mask",
}


def main() -> int:
    token = obtain_token()
    params = {
        "details": "true",
        "granularityType": "Marketplace",
        "granularityId": MARKETPLACE_ID,
        "marketplaceIds": MARKETPLACE_ID,
        "sellerSkus": ",".join(REQUESTED.values()),
    }
    status, payload = spapi_json(token, f"/fba/inventory/v1/summaries?{urllib.parse.urlencode(params)}")
    if status != 200:
        print(json.dumps({"ok": False, "httpStatus": status, "error": payload.get("errors") or payload.get("message") or "FBA inventory request failed"}))
        return 1

    by_asin: dict[str, dict] = {}
    for item in payload.get("payload", {}).get("inventorySummaries", []) or []:
        asin = str(item.get("asin") or "").strip().upper()
        details = item.get("inventoryDetails") or {}
        if asin in REQUESTED:
            by_asin[asin] = {
                "asin": asin,
                "sku": str(item.get("sellerSku") or ""),
                "fulfillableQuantity": int(details.get("fulfillableQuantity") or 0),
                "inboundWorkingQuantity": int(details.get("inboundWorkingQuantity") or 0),
                "inboundShippedQuantity": int(details.get("inboundShippedQuantity") or 0),
                "inboundReceivingQuantity": int(details.get("inboundReceivingQuantity") or 0),
            }

    result = []
    for asin, sku in REQUESTED.items():
        row = by_asin.get(asin)
        result.append({
            "asin": asin,
            "sku": sku,
            "found": row is not None,
            "fulfillableQuantity": row["fulfillableQuantity"] if row else None,
            "eligible": bool(row and row["fulfillableQuantity"] > 0),
            "inboundWorkingQuantity": row["inboundWorkingQuantity"] if row else None,
            "inboundShippedQuantity": row["inboundShippedQuantity"] if row else None,
            "inboundReceivingQuantity": row["inboundReceivingQuantity"] if row else None,
        })
    print(json.dumps({"ok": True, "marketplace": "US", "results": result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
