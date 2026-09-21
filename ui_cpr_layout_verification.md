# CPR and Compact Layout Verification Notes

## Visual inspection summary
1. **Left-side Listing list**: The column is condensed to 360px on desktop with compact card paddings (2.5), smaller icons, and streamlined metadata (FBA stock, in-transit stock, reviews, and quick tags), saving significant horizontal space.
2. **Right-side keyword table**:
   - Spans the remainder of the 1600px max-width container with a table-fixed layout and defined percentage column widths.
   - All 13 columns are fully visible without horizontal scroll:
     - 核心关键词
     - 来源 (SQP / 广告 / 自然)
     - 月搜
     - 转化
     - CVR
     - 今日自然位 (包含亚马逊结果页码)
     - CPR 8天估算 (包含悬停说明：基于自然第 21–30 位月销均值)
     - 广告位 PC
     - SBV 位 PC
     - 昨日自然
     - 日变化
     - 7日趋势 (微型走势图)
     - 最佳
3. **Data status**:
   - The CPR column cleanly surfaces the auditable `待计算` status pending provider-level sales samples, with full tooltip explanation.
   - PC ad and SBV ranks cleanly show `待采` when uncollected and `3页外` when sentinel 999 is recorded.
   - Dual first-page badges and defensive advertising hints remain intact.
