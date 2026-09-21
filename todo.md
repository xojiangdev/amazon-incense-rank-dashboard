# Live FBA Listing Import Tracker

## Scope
- **Marketplaces:** Amazon US and Canada through the North America SP-API connection; Amazon Japan through the dedicated Japan SP-API connection.
- **Inclusion:** Seller Central status Active, source fulfillment channel AMAZON_NA (FBA), strictly positive FBA fulfillable inventory, and only incense sticks, incense burners, or incense holders.
- **Exclusion:** FBM, inactive, suppressed, stranded, out-of-stock listings, and all non-target categories.
- **Keyword coverage:** 6–20 conversion-qualified core keywords per retained listing.

## Tasks

| ID | Status | Work item | Acceptance condition |
|---|---|---|---|
| LIVE-01 | In progress | Enable Japan SP-API connection | Dedicated Japan credentials are available independently from North America. |
| LIVE-02 | Pending | Verify SP-API credentials for North America | Read-only access works for US and CA marketplaces. |
| LIVE-03 | Pending | Verify SP-API credentials for Japan | Read-only access works for JP marketplace. |
| LIVE-04 | Pending | Retrieve seller listing and FBA inventory source records | Complete source records available for every configured marketplace. |
| LIVE-05 | Pending | Filter valid target records | Retained set is FBA + active + target incense category only. |
| LIVE-06 | Pending | Import verified listings and conversion terms | Dashboard contains only audited real listings and 6–20 terms per listing. |
| LIVE-07 | Pending | Validate dashboard totals and audit export | Counts reconcile to the SP-API source reports by marketplace. |

## Known constraints
- The North America and Japan credentials must remain separate; credentials are never mixed between regions.
- Import uses read-only Seller Partner API operations. No listing, inventory, price, or advertising changes are made.
- The existing database has been cleared of all demonstration records prior to the live import.
