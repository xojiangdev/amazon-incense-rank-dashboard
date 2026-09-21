import {
  getListingById,
  getListings,
  reorderListings,
  updateListingOrganization,
} from "./server/db";

const before = await getListings();
if (before.length < 2) throw new Error("Need at least two live Listings for smoke test");
const originalIds = before.map(item => item.id);
const first = before[0]!;
const second = before[1]!;
const swappedIds = [second.id, first.id, ...originalIds.slice(2)];

await reorderListings(swappedIds);
const afterSwap = await getListings();
if (afterSwap[0]?.id !== second.id || afterSwap[1]?.id !== first.id) {
  throw new Error("Persisted Listing reorder failed");
}
await reorderListings(originalIds);
const afterRestore = await getListings();
if (afterRestore[0]?.id !== first.id || afterRestore[1]?.id !== second.id) {
  throw new Error("Listing order restoration failed");
}

await updateListingOrganization(first.id, "custom", "SMOKE_TEST", "Temporary smoke-test note");
const changed = await getListingById(first.id);
if (changed?.salesCategory !== "custom" || changed.customCategoryLabel !== "SMOKE_TEST" || changed.salesNotes !== "Temporary smoke-test note") {
  throw new Error("Listing classification/note persistence failed");
}
await updateListingOrganization(
  first.id,
  first.salesCategory,
  first.customCategoryLabel ?? undefined,
  first.salesNotes ?? undefined
);
const restored = await getListingById(first.id);
if (
  restored?.salesCategory !== first.salesCategory ||
  restored.customCategoryLabel !== first.customCategoryLabel ||
  restored.salesNotes !== first.salesNotes
) {
  throw new Error("Listing classification/note restoration failed");
}

console.log(JSON.stringify({
  reorderPersistedAndRestored: true,
  classificationPersistedAndRestored: true,
  testedListingId: first.id,
}, null, 2));
process.exit(0);
