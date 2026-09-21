# PC Advertising Rank Columns Verification

The dashboard keyword table has been updated to include two new columns positioned directly following "今日自然位" and before "昨日自然位":
1. **广告排名 (PC)**: Displays the keyword's desktop Sponsored Products/Brands placement position (e.g., `#2`), or `未入前3页` / `—` when unobserved.
2. **SBV广告排名 (PC)**: Displays the keyword's desktop Sponsored Brands Video placement position (e.g., `#1`), or `未入前3页` / `—` when unobserved.

The database tables `keywords` and `daily_rank_snapshots` now have persistent `pcAdRank` and `pcSbvRank` columns, the atomic rank ingestion schema accepts these fields, the CSV export has been updated, and the daily 07:00 automated playbook includes collecting PC desktop ad and SBV ad ranks.
