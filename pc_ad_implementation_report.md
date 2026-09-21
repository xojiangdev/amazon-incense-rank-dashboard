# PC Advertising Ranks and Filtering Implementation Report

## UI & Feature Implementation
1. **Advertising Filter Dropdown**: Added next to the high-value badge in the keyword statistics table. Supports:
   - 全部核心词
   - 仅看有广告 / SBV
   - 仅看常规广告位
   - 仅看 SBV 广告位
   - 前三页未检索到广告
2. **Dual First Page Badge**: When both the organic rank and either PC ad or PC SBV ad rank enter page one (rank <= 48), the keyword displays an emerald `双首页占位` badge.
3. **Defensive Ad Status**: For keywords where both PC ad and PC SBV ad ranks are confirmed absent from the first 3 pages (rank = 999), a subtle grey badge displays `前三页未检索到广告 · 可补精准防御`.
4. **Clean Ingestion & Integrity**: The database schema and atomic validator preserve previous organic ranks, daily rank changes, and 7-day trend sparklines intact. When ad ranks are not yet available, cells display an explicit `等待采集` instead of simulated values.

## Live Collection Audit
- Attempted immediate live pull across all 262 keywords via DataForSEO desktop Amazon SERP.
- Both regional subtasks encountered DataForSEO upstream transport errors (`unexpected nil response` / `transport closed`) across multiple core keywords.
- Per strict non-negotiable rules (fail-closed, no partial writes, no estimated/simulated ranks), the incomplete batches were rejected and written to:
  - `/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import/pc_ad_results_us.error.json`
  - `/home/ubuntu/amazon-incense-rank-dashboard/private_spapi_import/pc_ad_results_ca.error.json`
- The daily 07:00 recurring task is fully configured to execute the 4-phase audit including desktop PC ad and SBV ranks on every run.
