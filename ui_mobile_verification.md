# Mobile View Verification Notes

## Mobile Screen Verification (375x812)
1. **Header & Navigation**:
   - The header collapses into a two-column action bar (`立即抓取今日最新排名` and `手动录入/同步商品`) without text clipping or horizontal overflow.
   - The marketplace tabs stack compactly and allow quick one-tap switching between All, US, CA, and JP.
2. **KPI Cards**:
   - Organized into a clean 2x2 grid that fits within the viewport.
   - Key counts (42 Listings, 262 keywords, risen/dropped alerts) remain legible with appropriate touch targets.
3. **Keyword Ranking Details**:
   - The full 13-column desktop table is hidden on screens under 1024px.
   - Replaced by a native mobile card list for each keyword:
     - Top row: keyword text, provenance badge (SQP/Ads/Organic), search volume, conversion rate, and dual first-page indicator.
     - Middle metric box: Today's Natural Rank (`#47 P1`), CPR 8-day estimate, and 7-day sparkline.
     - Advertising status box: PC Ad Rank and PC SBV Rank badges (`待采` / `#rank` / `3页外`).
     - Footer: Yesterday's rank, daily change, and best rank.
   - Eliminates awkward horizontal panning on mobile devices while preserving all metrics.
