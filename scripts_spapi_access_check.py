#!/usr/bin/env python3
"""Read-only health check for separate Amazon SP-API regional credentials.
Prints no secrets and makes no seller-account mutations.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class RegionConfig:
    label: str
    base_url: str
    client_id_env: str
    client_secret_env: str
    refresh_token_env: str
    marketplaces: dict[str, str]


REGIONS = [
    RegionConfig(
        label="North America",
        base_url="https://sellingpartnerapi-na.amazon.com",
        client_id_env="SPAPI_CLIENT_ID",
        client_secret_env="SPAPI_CLIENT_SECRET",
        refresh_token_env="SPAPI_REFRESH_TOKEN",
        marketplaces={"US": "ATVPDKIKX0DER", "CA": "A2EUQ1WTGCTBG2"},
    ),
    RegionConfig(
        label="Japan",
        base_url="https://sellingpartnerapi-fe.amazon.com",
        client_id_env="SPAPI_JP_CLIENT_ID",
        client_secret_env="SPAPI_JP_CLIENT_SECRET",
        refresh_token_env="SPAPI_JP_REFRESH_TOKEN",
        marketplaces={"JP": "A1VC38T7YXB528"},
    ),
]


def request_json(url: str, method: str = "GET", headers: dict[str, str] | None = None, form: dict[str, str] | None = None) -> tuple[int, dict]:
    body = None
    request_headers = headers or {}
    if form is not None:
        body = urllib.parse.urlencode(form).encode("utf-8")
        request_headers = {**request_headers, "Content-Type": "application/x-www-form-urlencoded"}
    req = urllib.request.Request(url, data=body, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as err:
        body_text = err.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body_text)
        except json.JSONDecodeError:
            payload = {"raw": body_text[:1000]}
        return err.code, payload


def obtain_access_token(region: RegionConfig) -> tuple[bool, str | None, dict]:
    client_id = os.getenv(region.client_id_env)
    client_secret = os.getenv(region.client_secret_env)
    refresh_token = os.getenv(region.refresh_token_env)
    if not all([client_id, client_secret, refresh_token]):
        return False, None, {"error": "missing credentials", "required": [region.client_id_env, region.client_secret_env, region.refresh_token_env]}
    status, payload = request_json(
        "https://api.amazon.com/auth/o2/token",
        method="POST",
        form={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    token = payload.get("access_token") if 200 <= status < 300 else None
    return bool(token), token, {"http_status": status, "has_access_token": bool(token), "error": payload.get("error")}


def sanitize_error(payload: dict) -> dict:
    return {
        "errors": payload.get("errors"),
        "error": payload.get("error"),
        "message": payload.get("message"),
        "raw": payload.get("raw"),
    }


def check_region(region: RegionConfig) -> dict:
    token_ok, token, token_result = obtain_access_token(region)
    result: dict = {
        "region": region.label,
        "endpoint": region.base_url,
        "token": token_result,
        "marketplaces_requested": region.marketplaces,
    }
    if not token_ok or not token:
        return result

    status, payload = request_json(
        f"{region.base_url}/sellers/v1/marketplaceParticipations",
        headers={"x-amz-access-token": token},
    )
    result["marketplace_participations"] = {"http_status": status}
    if 200 <= status < 300:
        participation_list = payload.get("payload", [])
        ids = []
        for item in participation_list:
            marketplace = item.get("marketplace", {})
            if marketplace.get("id"):
                ids.append({"id": marketplace.get("id"), "name": marketplace.get("name"), "countryCode": marketplace.get("countryCode")})
        result["marketplace_participations"]["accessible_marketplaces"] = ids
    else:
        result["marketplace_participations"]["error"] = sanitize_error(payload)
    return result


def main() -> int:
    results = [check_region(region) for region in REGIONS]
    print(json.dumps({"read_only": True, "results": results}, ensure_ascii=False, indent=2))
    healthy = all(r["token"].get("has_access_token") and r.get("marketplace_participations", {}).get("http_status") == 200 for r in results)
    return 0 if healthy else 2


if __name__ == "__main__":
    sys.exit(main())
