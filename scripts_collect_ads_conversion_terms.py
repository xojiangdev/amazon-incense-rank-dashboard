#!/usr/bin/env python3
"""Read-only SP search-term reports for US/CA conversion-evidence keyword selection."""
import datetime as dt
import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from pathlib import Path

ROOT = Path("/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import")
PROFILES = {"US": "898659032586056", "CA": "673034626677273"}


def request_json(url: str, *, method: str = "GET", headers: dict | None = None, payload: dict | None = None):
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"Ads API HTTP {error.code}: {detail}") from error


def access_token():
    payload = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": os.environ["AMAZON_ADS_REFRESH_TOKEN"],
        "client_id": os.environ["AMAZON_ADS_CLIENT_ID"],
        "client_secret": os.environ["AMAZON_ADS_CLIENT_SECRET"],
    }).encode()
    request = urllib.request.Request("https://api.amazon.com/auth/o2/token", data=payload, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)["access_token"]


def main():
    token = access_token()
    today = dt.date.today()
    start = today - dt.timedelta(days=31)
    all_rows = []
    report_audit = []

    for marketplace, profile_id in PROFILES.items():
        headers = {
            "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
            "Authorization": f"Bearer {token}",
            "Amazon-Advertising-API-ClientId": os.environ["AMAZON_ADS_CLIENT_ID"],
            "Amazon-Advertising-API-Scope": profile_id,
        }
        report_request = {
            "name": f"Strict keyword selection SP search terms {marketplace} {start} to {today}",
            "startDate": str(start),
            "endDate": str(today),
            "configuration": {
                "adProduct": "SPONSORED_PRODUCTS",
                "groupBy": ["searchTerm"],
                "columns": ["searchTerm", "advertisedAsin", "advertisedSku", "impressions", "clicks", "cost", "purchases14d", "sales14d", "unitsSold14d"],
                "reportTypeId": "spSearchTerm",
                "timeUnit": "SUMMARY",
                "format": "GZIP_JSON",
            },
        }
        created = request_json("https://advertising-api.amazon.com/reporting/reports", method="POST", headers=headers, payload=report_request)
        report_id = created["reportId"]
        deadline = time.time() + 540
        status = None
        while time.time() < deadline:
            status = request_json(f"https://advertising-api.amazon.com/reporting/reports/{report_id}", headers={key: value for key, value in headers.items() if key != "Content-Type"})
            if status.get("status") == "COMPLETED":
                break
            if status.get("status") in {"FAILED", "CANCELLED"}:
                raise RuntimeError(f"{marketplace} Ads report {report_id} ended {status.get('status')}: {status}")
            time.sleep(10)
        if not status or status.get("status") != "COMPLETED" or not status.get("url"):
            raise TimeoutError(f"{marketplace} Ads report did not complete within 9 minutes")
        with urllib.request.urlopen(status["url"], timeout=120) as response:
            payload = response.read()
        if status.get("fileSize", 0) and payload[:2] == b"\x1f\x8b":
            payload = gzip.decompress(payload)
        rows = json.loads(payload)
        for row in rows:
            row["marketplace"] = marketplace
        all_rows.extend(rows)
        report_audit.append({"marketplace": marketplace, "profileId": profile_id, "reportId": report_id, "rows": len(rows), "startDate": str(start), "endDate": str(today)})

    output = {"observedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "reports": report_audit, "rows": all_rows}
    out_path = ROOT / "ads_search_term_conversion_evidence.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(json.dumps({"outputPath": str(out_path), "reports": report_audit, "totalRows": len(all_rows)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
