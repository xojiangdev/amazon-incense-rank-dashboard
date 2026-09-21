import { describe, expect, it } from "vitest";
import {
  listingOrganizationInputSchema,
  mergeOrderedSubset,
  reorderListingsInputSchema,
} from "./listingOrganization";

describe("Listing organization", () => {
  it("moves a filtered subset without disturbing hidden Listing slots", () => {
    expect(mergeOrderedSubset([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
  });

  it("rejects duplicate or unknown Listing IDs", () => {
    expect(reorderListingsInputSchema.safeParse({ orderedIds: [1, 1] }).success).toBe(false);
    expect(() => mergeOrderedSubset([1, 2, 3], [2, 9])).toThrow(/不存在/);
  });

  it("requires a label for custom classification and accepts free notes", () => {
    expect(
      listingOrganizationInputSchema.safeParse({
        listingId: 1,
        salesCategory: "custom",
        customCategoryLabel: "",
        salesNotes: "Sales note",
      }).success
    ).toBe(false);
    expect(
      listingOrganizationInputSchema.safeParse({
        listingId: 1,
        salesCategory: "custom",
        customCategoryLabel: "季节性重点",
        salesNotes: "Q4重点备货",
      }).success
    ).toBe(true);
  });
});
