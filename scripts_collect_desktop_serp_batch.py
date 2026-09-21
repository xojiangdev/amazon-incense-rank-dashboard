#!/usr/bin/env python3
"""Run bounded concurrent DataForSEO desktop SERP queries and process CPR/ad ranks."""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

root = Path("/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import")
targets_file = root / "desktop_serp_workflow_targets.json"
targets = json.loads(targets_file.read_text())

print(f"Loaded {len(targets)} targets for desktop SERP collection.")

results = []
output_file = root / "desktop_serp_live_batch.jsonl"
seen_keys = set()
if output_file.exists():
    for line in output_file.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            seen_keys.add(f"{row['marketplace']}:{row['keyword'].strip().lower()}")

print(f"Already processed: {len(seen_keys)} queries.")
pending = [t for t in targets if f"{t['marketplace']}:{t['keyword'].strip().lower()}" not in seen_keys]
print(f"Pending queries to collect: {len(pending)}")
