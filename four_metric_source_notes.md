# Live metric collection sources

- **Natural rank:** Sorftime `product_traffic_terms`, exact normalized keyword match to `latest_organic_position`; parse `Page X, Pos Y/Z` as `(X-1)*Z+Y`. The 2026-09-21 live check for US ASIN `B0GZDJVS2P` returned current organic data such as `agarwood incense` at Page 2 Pos 46/48 and `agarwood incense sticks` at Page 2 Pos 19/50.
- **PC ad and SBV ranks:** DataForSEO `merchant_amazon_products_live_advanced`, scoped to country and language. Match target `data_asin` exactly. `type=amazon_paid` is an ad occurrence; an URL containing `sbv_search` identifies Sponsored Brands Video.
- **CPR:** DataForSEO organic `amazon_serp` items ranked 21–30 with a non-null `bought_past_month`. Use only five or more observed sales values; compute `ceil(average_monthly_sales * 8 / 30)`. A missing sample set remains null rather than estimated.

The verified DataForSEO US example for `agarwood incense sticks` included `amazon_paid` with an `sbv_search` URL and organic results containing `bought_past_month`, confirming the necessary fields are live and distinct.
