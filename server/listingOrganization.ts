import { z } from "zod";

export const salesCategorySchema = z.enum([
  "unclassified",
  "new_product",
  "key_product",
  "long_tail",
  "regular",
  "discontinued",
  "custom",
]);

export const listingOrganizationInputSchema = z
  .object({
    listingId: z.number().int().positive(),
    salesCategory: salesCategorySchema,
    customCategoryLabel: z.string().trim().max(80).optional(),
    salesNotes: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.salesCategory === "custom" && !value.customCategoryLabel?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customCategoryLabel"],
        message: "自定义分类名称不能为空",
      });
    }
  });

export const reorderListingsInputSchema = z.object({
  orderedIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(500)
    .refine(ids => new Set(ids).size === ids.length, "Listing 排序不能包含重复 ID"),
});

export const bulkListingOrganizationInputSchema = z
  .object({
    listingIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(500)
      .refine(ids => new Set(ids).size === ids.length, "批量操作不能包含重复 Listing"),
    salesCategory: salesCategorySchema.optional(),
    customCategoryLabel: z.string().trim().max(80).optional(),
    notesAction: z.enum(["keep", "append", "replace", "clear"]).default("keep"),
    salesNotes: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.salesCategory && value.notesAction === "keep") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请至少修改分类或备注" });
    }
    if (value.salesCategory === "custom" && !value.customCategoryLabel?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customCategoryLabel"],
        message: "自定义分类名称不能为空",
      });
    }
    if (["append", "replace"].includes(value.notesAction) && !value.salesNotes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salesNotes"],
        message: "追加或覆盖备注时内容不能为空",
      });
    }
  });

export function mergeOrderedSubset(currentIds: number[], orderedSubset: number[]) {
  const currentSet = new Set(currentIds);
  if (orderedSubset.some(id => !currentSet.has(id))) {
    throw new Error("排序请求包含不存在或不在当前在售池中的 Listing");
  }
  const requestedSet = new Set(orderedSubset);
  const slots = currentIds.map((id, index) => (requestedSet.has(id) ? index : -1)).filter(index => index >= 0);
  if (slots.length !== orderedSubset.length) {
    throw new Error("排序请求与当前在售 Listing 不一致");
  }
  const merged = [...currentIds];
  slots.forEach((slot, index) => {
    merged[slot] = orderedSubset[index]!;
  });
  return merged;
}

export type SalesCategory = z.infer<typeof salesCategorySchema>;
