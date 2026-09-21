# Verified product metric sources

Amazon's official FBA Inventory `getInventorySummaries` schema returns `fulfillableQuantity`, `inboundWorkingQuantity`, `inboundShippedQuantity`, and `inboundReceivingQuantity` in `inventoryDetails`; `totalQuantity` is on the inventory summary object. Source: https://developer-docs.amazon.com/sp-api/reference/getinventorysummaries

Amazon's official Customer Feedback API provides customer review/return insights and review topics, but its ASIN review-topic response exposes topic mentions and `starRatingImpact`, not the current aggregate product average star rating plus total review count needed by this dashboard. The API is available in US and Japan but not Canada. Sources: https://developer-docs.amazon.com/sp-api/reference/customer-feedback-v2024-06-01 and https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/customer-feedback-api-model/customerFeedback_2024-06-01.json

Sorftime MCP `product_detail` supports US, CA, and JP and returns `star_rating` and `review_count` for an exact marketplace + ASIN. It is therefore the selected scheduled source for public review metrics. A live test returned exact fields for US ASIN B0FY67W88Z and CA ASIN B0FY6MK2D4.

DataForSEO `merchant_amazon_asin_live_advanced` also returns a rating object with `value` and `votes_count`; it was used as an independent spot-check source. SerpAPI's documented `amazon_product` engine also returns `product_results.rating` and `product_results.reviews`, but the configured SerpAPI credential returned HTTP 403 and is not used. Source: https://serpapi.com/amazon-product-api
