import { describe, expect, it } from "vitest";
import { classifyIncenseCategory, resolveListingCategory } from "./rankEngine";

describe("manual category exception guard", () => {
  it("continues to classify regular target incense products", () => {
    expect(classifyIncenseCategory("Natural Sandalwood Incense Sticks")).toBe("incense_sticks");
    expect(resolveListingCategory({
      marketplace: "US",
      asin: "B0GWVDR845",
      title: "Natural Pine Cone Incense Sticks",
      manualCategoryOverride: true,
    })).toMatchObject({ category: "incense_sticks", exception: null });
  });

  it("permits only the two approved non-incense ASINs through the manual path", () => {
    expect(resolveListingCategory({
      marketplace: "US",
      asin: "B0H3J6LR1K",
      title: "Yinjiyue Sandalwood Essential Oil 10ml",
      manualCategoryOverride: true,
    })).toMatchObject({ category: "other", exception: { label: "精油" } });
    expect(resolveListingCategory({
      marketplace: "US",
      asin: "B0HJ1GPC2S",
      title: "yinjiyue Weighted Eye Mask for Sleeping",
      manualCategoryOverride: true,
    })).toMatchObject({ category: "other", exception: { label: "眼罩" } });
  });

  it("does not allow the exception through automatic sync or for arbitrary ASINs", () => {
    expect(resolveListingCategory({
      marketplace: "US",
      asin: "B0H3J6LR1K",
      title: "Yinjiyue Sandalwood Essential Oil 10ml",
      manualCategoryOverride: false,
    })).toMatchObject({ category: "other", exception: null });
    expect(resolveListingCategory({
      marketplace: "US",
      asin: "B012345678",
      title: "Unrelated Product",
      manualCategoryOverride: true,
    })).toMatchObject({ category: "other", exception: null });
  });
});
