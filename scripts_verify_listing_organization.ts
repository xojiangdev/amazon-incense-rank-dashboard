import { getListings } from "./server/db";

const rows = await getListings();
const orders = rows.map(item => item.manualSortOrder);
const categoryCounts = rows.reduce<Record<string, number>>((counts, item) => {
  counts[item.salesCategory] = (counts[item.salesCategory] ?? 0) + 1;
  return counts;
}, {});
const audit = {
  liveListings: rows.length,
  allHaveManualOrder: orders.every(order => order > 0),
  uniqueManualOrders: new Set(orders).size === orders.length,
  sortedByManualOrder: orders.every((order, index) => index === 0 || orders[index - 1]! < order),
  categoryCounts,
  editableFieldsPresent: rows.every(item => "customCategoryLabel" in item && "salesNotes" in item),
};
console.log(JSON.stringify(audit, null, 2));
process.exit(Object.values(audit).some(value => value === false) ? 2 : 0);
