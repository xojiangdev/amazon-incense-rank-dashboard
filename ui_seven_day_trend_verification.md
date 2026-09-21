# Seven-day trend and Listing filter visual verification

The dashboard loaded with 42 live Listings and 262 tracked keywords. The sales-category selector is now positioned on the right side of the “在售 Listing 列表” heading and exposes the intended category filter entry point. The right detail panel shows a new “最近 7 天真实自然位趋势” card with an average/individual-keyword selector, a 1/7-day completeness badge, and a chart covering 09/15–09/21. Only the real 09/21 snapshot is plotted; earlier dates are intentionally blank rather than fabricated. The existing keyword table remains directly below the chart.

The layout remains readable at 1440px width, and the Listing cards retain their colored category accents and batch-edit controls.

Interactive verification passed: opening the right-side selector exposed 常规产品、重点产品、长尾产品、DISCONTINUED、自定义分类、新品和未分类. Selecting DISCONTINUED reduced the Listing count from 42 to 2 and automatically switched the detail panel to a matching DISCONTINUED Listing while preserving the seven-day trend chart and keyword table.
