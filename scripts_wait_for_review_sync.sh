#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/amazon-incense-rank-dashboard
for attempt in $(seq 1 30); do
  output=$(timeout 40s npx tsx scripts_audit_listing_metrics.ts 2>/dev/null || true)
  synchronized=$(printf '%s' "$output" | jq -r '.reviews.synchronized // 0' 2>/dev/null || printf '0')
  echo "review-sync check ${attempt}/30: synchronized=${synchronized}/42"
  if [ "$synchronized" = "42" ]; then
    printf '%s\n' "$output"
    exit 0
  fi
  sleep 40
done
echo "review metric synchronization did not reach 42/42 within 20 minutes" >&2
exit 1
