export type ListingMarketplace = "US" | "CA" | "JP";

export type ListingDeepLink = {
  asin: string | null;
  marketplace: ListingMarketplace | null;
  invalidMarketplace: boolean;
};

/** Query parameters select a market explicitly; never substitute another market. */
export function parseListingDeepLink(search: string): ListingDeepLink {
  const params = new URLSearchParams(search);
  const asin = params.get("asin")?.trim().toUpperCase() || null;
  const market = params.get("marketplace")?.trim().toUpperCase() || null;
  const marketplace = market === "US" || market === "CA" || market === "JP" ? market : null;
  return { asin, marketplace, invalidMarketplace: market !== null && marketplace === null };
}

export function findDeepLinkedListing<T extends { asin: string; marketplace: string }>(
  listings: readonly T[],
  link: ListingDeepLink,
): T | undefined {
  if (!link.asin || link.invalidMarketplace) return undefined;
  return listings.find(item =>
    item.asin.trim().toUpperCase() === link.asin &&
    (link.marketplace === null || item.marketplace === link.marketplace),
  );
}
