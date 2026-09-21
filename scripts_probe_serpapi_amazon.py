#!/usr/bin/env python3
"""Read-only probe of the configured SerpAPI Amazon desktop result shape."""
import json
import os
import sys
from urllib.parse import urlencode
from urllib.request import urlopen

keyword = sys.argv[1] if len(sys.argv) > 1 else "incense holder"
params = {
    "engine": "amazon",
    "amazon_domain": "amazon.com",
    "k": keyword,
    "api_key": os.environ["SERPAPI_API_KEY"],
}
with urlopen(f"https://serpapi.com/search.json?{urlencode(params)}", timeout=60) as response:
    data = json.load(response)

summary = {
    "search_metadata": {key: data.get("search_metadata", {}).get(key) for key in ("status", "id")},
    "error": data.get("error"),
    "keys": sorted(data.keys()),
    "sponsored_keys": [key for key in data if "sponsor" in key.lower() or "video" in key.lower()],
}
for key in summary["sponsored_keys"]:
    value = data.get(key)
    summary[key] = value[:3] if isinstance(value, list) else value
print(json.dumps(summary, ensure_ascii=False, indent=2))
