export type MarketplaceCode = "US" | "CA" | "JP";

export type ManualCategoryException = {
  marketplace: MarketplaceCode;
  asin: string;
  label: string;
  categoryName: string;
};

/**
 * Explicit, user-authorized manual exceptions to the incense-only automatic
 * catalog guard. They remain subject to FBA, Active, and positive sellable
 * inventory requirements; automatic catalog synchronization never gains this
 * exception.
 */
export const MANUAL_CATEGORY_EXCEPTIONS: readonly ManualCategoryException[] = [
  {
    marketplace: "US",
    asin: "B0H3J6LR1K",
    label: "精油",
    categoryName: "手动豁免 · 精油",
  },
  {
    marketplace: "US",
    asin: "B0HJ1GPC2S",
    label: "眼罩",
    categoryName: "手动豁免 · 眼罩",
  },
  {
    marketplace: "US",
    asin: "B0GZDGRVCP",
    label: "紫藤线香（断货保护，人工激活）",
    categoryName: "手动豁免 · 断货激活",
  },
  {
    marketplace: "US",
    asin: "B0FY6MCXS7",
    label: "历史listing（人工激活）",
    categoryName: "手动豁免 · 人工激活",
  },
  {
    marketplace: "US",
    asin: "B0GDKRTTJ1",
    label: "倒插香插（断货保护，人工激活）",
    categoryName: "手动豁免 · 断货激活",
  },
] as const;

export function getManualCategoryException(marketplace: MarketplaceCode, asin: string) {
  const normalizedAsin = asin.trim().toUpperCase();
  return MANUAL_CATEGORY_EXCEPTIONS.find(item => item.marketplace === marketplace && item.asin === normalizedAsin) ?? null;
}

export function isManualCategoryException(marketplace: MarketplaceCode, asin: string) {
  return getManualCategoryException(marketplace, asin) !== null;
}
