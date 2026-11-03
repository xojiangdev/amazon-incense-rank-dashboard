import { describe, expect, it } from "vitest";
import {
  findDeepLinkedListing,
  parseListingDeepLink,
} from "../shared/listingDeepLink";

type FixtureListing = {
  id: number;
  asin: string;
  marketplace: string;
};

const listings: readonly FixtureListing[] = [
  { id: 1, asin: "B0SAMEASIN", marketplace: "US" },
  { id: 2, asin: "B0SAMEASIN", marketplace: "CA" },
  { id: 3, asin: "B0SAMEASIN", marketplace: "JP" },
];

describe("listing deep links", () => {
  it.each([
    ["US", 1],
    ["CA", 2],
    ["JP", 3],
  ])("selects the same ASIN in the explicit %s marketplace", (marketplace, id) => {
    const link = parseListingDeepLink(`?asin=B0SAMEASIN&marketplace=${marketplace}`);

    expect(findDeepLinkedListing(listings, link)?.id).toBe(id);
  });

  it("does not fall back to another marketplace when the explicit market is missing", () => {
    const link = parseListingDeepLink("?asin=B0MISSING&marketplace=JP");

    expect(findDeepLinkedListing(listings, link)).toBeUndefined();
  });

  it("trims, uppercases, and URL-decodes ASIN and marketplace values", () => {
    const link = parseListingDeepLink(
      "?asin=%20b0sameasin%20&marketplace=%20ca%20",
    );

    expect(link).toEqual({
      asin: "B0SAMEASIN",
      marketplace: "CA",
      invalidMarketplace: false,
    });
    expect(findDeepLinkedListing(listings, link)?.id).toBe(2);
  });

  it("parses a marketplace-only JP link without selecting a listing", () => {
    const link = parseListingDeepLink("?marketplace=JP");

    expect(link).toEqual({
      asin: null,
      marketplace: "JP",
      invalidMarketplace: false,
    });
    expect(findDeepLinkedListing(listings, link)).toBeUndefined();
  });

  it("returns an empty link when parameters are absent", () => {
    const link = parseListingDeepLink("");

    expect(link).toEqual({
      asin: null,
      marketplace: null,
      invalidMarketplace: false,
    });
    expect(findDeepLinkedListing(listings, link)).toBeUndefined();
  });

  it("marks an invalid nonempty marketplace and does not match it", () => {
    const link = parseListingDeepLink("?asin=B0SAMEASIN&marketplace=AU");

    expect(link).toEqual({
      asin: "B0SAMEASIN",
      marketplace: null,
      invalidMarketplace: true,
    });
    expect(findDeepLinkedListing(listings, link)).toBeUndefined();
  });

  it("returns undefined for an empty listing array", () => {
    const link = parseListingDeepLink("?asin=B0SAMEASIN&marketplace=US");

    expect(findDeepLinkedListing([], link)).toBeUndefined();
  });

  it("preserves ASIN-only matching compatibility by returning the first market match", () => {
    const link = parseListingDeepLink("?asin=B0SAMEASIN");

    expect(link).toEqual({
      asin: "B0SAMEASIN",
      marketplace: null,
      invalidMarketplace: false,
    });
    expect(findDeepLinkedListing(listings, link)?.id).toBe(1);
  });
});
