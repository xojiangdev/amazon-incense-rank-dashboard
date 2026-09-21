#!/usr/bin/env python3
"""Generate deterministic workflow input from current grouped desktop SERP targets."""
import json
from pathlib import Path

root = Path("/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import")
data = json.loads((root / "desktop_serp_targets.json").read_text())
targets = data["targets"]
print(json.dumps(targets, ensure_ascii=False, separators=(",", ":")))
