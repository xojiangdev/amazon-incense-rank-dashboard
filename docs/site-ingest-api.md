# Site Ingestion API

These endpoints provide a **database-safe external ingestion path** for the Amazon Incense Rank Dashboard. They do not require a `DATABASE_URL` or a Manus session cookie.

## Authentication

Set the server-side secret `SITE_INGEST_TOKEN` in the application settings. Every ingestion request must include it in the `x-ingest-token` header. The token is checked on the server and is never returned by the API.

```http
Content-Type: application/json
x-ingest-token: <SITE_INGEST_TOKEN>
```

Existing cron and Manus administrator authentication remain supported. If `SITE_INGEST_TOKEN` is not configured, token-only requests are rejected.

## 1. FBA stock snapshot

**Public endpoint:** `POST /api/ingest/refreshFbaStock`

This endpoint accepts a **complete snapshot for each submitted marketplace**. It updates only Listing catalog and inventory fields: FBA sellable inventory, three inbound quantities, total inbound quantity, and Active status. It does not touch keywords, natural ranks, PC/SBV ranks, CPR, or daily rank snapshots.

The accepted candidate fields are the external equivalents of the rows consumed by `scripts_import_verified_fba.ts`. `fba_inbound_total` must exactly equal the sum of `fba_inbound_working`, `fba_inbound_shipped`, and `fba_inbound_receiving`. Candidates must be FBA, Active, positive-stock, and in one of the three target incense categories.

```json
{
  "observedAt": "2026-09-22T03:00:00.000Z",
  "snapshots": [
    {
      "marketplace": "US",
      "source_row_count": 36,
      "candidates": [
        {
          "marketplace": "US",
          "asin": "B0GWVDR845",
          "sku": "pineconehy",
          "title": "Natural Pine Cone Incense Sticks",
          "category": "incense_sticks",
          "category_name": "Incense products",
          "image_url": "",
          "price": "19.99",
          "currency": "USD",
          "fba_stock": 42,
          "fba_inbound_working": 2,
          "fba_inbound_shipped": 3,
          "fba_inbound_receiving": 1,
          "fba_inbound_total": 6,
          "fulfillment_channel": "FBA",
          "listing_status": "Active",
          "source_report_id": "seller-listings-report-20260922"
        }
      ]
    }
  ]
}
```

A submitted marketplace is reconciled atomically: matching listings are upserted; listings absent from that **complete** marketplace snapshot are set to `Inactive` with zero FBA stock. Do not submit a partial marketplace snapshot. A zero-candidate US/CA request is rejected as a safety guard; an empty JP snapshot is allowed when its source report supports it.

```bash
curl -X POST "https://cpr.yinjiyue.com/api/ingest/refreshFbaStock" \
  -H "Content-Type: application/json" \
  -H "x-ingest-token: $SITE_INGEST_TOKEN" \
  --data-binary @fba-snapshot.json
```

## 2. SQP core-keyword refresh

**Public endpoint:** `POST /api/ingest/refreshSqpKeywords`

This endpoint receives the **already-selected** core keyword set for each live FBA Listing. Its fields map directly to the selected rows written by `scripts_import_sqp_keywords.ts`, including `selection_basis`.

The payload must contain exactly one Listing block for every currently active FBA Listing, and each block must contain **6–20 distinct normalized search queries**. The accepted basis hierarchy is:

| `selection_basis` | Required evidence |
|---|---|
| `sqp_purchase` | `asin_purchase_count > 0` |
| `sqp_cart` | no purchase; `asin_cart_add_count > 0` |
| `sqp_click` | no purchase/cart; at least two clicks, or one click with search volume ≥ 20 |
| `title_fallback` | no observed clicks, carts, or purchases; used only to reach the six-term minimum |

```json
{
  "observedAt": "2026-09-22T03:05:00.000Z",
  "source": {
    "report_type": "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT",
    "start_date": "2026-08-01",
    "end_date": "2026-08-31"
  },
  "listings": [
    {
      "marketplace": "US",
      "asin": "B0GWVDR845",
      "terms": [
        {
          "marketplace": "US",
          "asin": "B0GWVDR845",
          "search_query": "pine cone incense",
          "search_query_score": 10,
          "search_query_volume": 120,
          "asin_impression_count": 1000,
          "asin_click_count": 10,
          "asin_cart_add_count": 3,
          "asin_purchase_count": 5,
          "asin_conversion_rate": 25,
          "asin_purchase_share": 12.5,
          "start_date": "2026-08-01",
          "end_date": "2026-08-31",
          "selection_basis": "sqp_purchase"
        },
        {
          "marketplace": "US",
          "asin": "B0GWVDR845",
          "search_query": "natural pine incense sticks",
          "search_query_score": 0,
          "search_query_volume": 0,
          "asin_impression_count": 0,
          "asin_click_count": 0,
          "asin_cart_add_count": 0,
          "asin_purchase_count": 0,
          "asin_conversion_rate": 0,
          "asin_purchase_share": 0,
          "start_date": "",
          "end_date": "",
          "selection_basis": "title_fallback"
        }
      ]
    }
  ]
}
```

The short example above shows two terms only for readability; production payloads must include 6–20 terms per Listing and every active FBA Listing.

Matching existing keyword rows are updated in place, preserving their natural-rank, PC ad/SBV, CPR, and daily-snapshot data. Newly added terms start with empty rank metrics. Previously core terms that are absent from the new complete set are retained for audit history but changed to non-core, so they are no longer displayed or tracked.

```bash
curl -X POST "https://cpr.yinjiyue.com/api/ingest/refreshSqpKeywords" \
  -H "Content-Type: application/json" \
  -H "x-ingest-token: $SITE_INGEST_TOKEN" \
  --data-binary @sqp-keywords.json
```

## Responses and safety behavior

A successful response returns `{ "ok": true, "result": ... }` with created, updated, retired, and per-marketplace counts as applicable. Validation errors return HTTP 400 and make **no database changes**. Authentication failures return HTTP 403. Neither endpoint modifies natural rank, advertising rank, SBV rank, CPR, or historical rank snapshots.

> The existing `/api/scheduled/*` routes remain reserved for Manus cron/admin calls. Use `/api/ingest/*` for external server-to-server traffic with `x-ingest-token`. The authenticated target-export endpoint is `GET /api/ingest/rankTargets`.

## Additional public mirrors

The following existing scheduled receivers are also available for external, token-authenticated ingestion. Their payload validation and write behavior is exactly the same as the corresponding scheduled handler.

| Public endpoint | Reused receiver |
|---|---|
| `POST /api/ingest/refreshDailyRank` | Real natural rank with PC ad and SBV fields |
| `POST /api/ingest/refreshProductMetrics` | Product rating and review-count refresh |
| `POST /api/ingest/githubCpr` | Repository-authoritative GitHub CPR document refresh |
