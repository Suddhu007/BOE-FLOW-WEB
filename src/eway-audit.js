import { isMissing, toNumber } from "./formatters.js";

export const AUDIT_FIELDS = Object.freeze([
  { key: "Quantity", label: "quantity" },
  { key: "GST Taxable Value (for E-Way)", label: "taxable value" },
  { key: "Calculated IGST", label: "Calculated IGST" },
]);

export function sumBackendValues(records, field) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const values = records.map((record) => toNumber(record?.[field]));
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function matchingGroupItems(group, items) {
  const hsn = isMissing(group?.["HSN Code"]) ? "" : String(group["HSN Code"]).trim();
  const uqc = isMissing(group?.UQC) ? "" : String(group.UQC).trim().toUpperCase();
  return (Array.isArray(items) ? items : []).filter((item) =>
    (isMissing(item?.["HSN Code"]) ? "" : String(item["HSN Code"]).trim()) === hsn
    && (isMissing(item?.UQC) ? "" : String(item.UQC).trim().toUpperCase()) === uqc
  );
}

function itemValue(item, field) {
  if (field === "Calculated IGST") {
    return toNumber(item?.["Calculated IGST"]) ?? toNumber(item?.["IGST Amount"]);
  }
  return toNumber(item?.[field]);
}

export function checkGroupTotals(group, items) {
  const matchingItems = matchingGroupItems(group, items);
  const checks = AUDIT_FIELDS.map(({ key, label }) => {
    const groupValue = toNumber(group?.[key]);
    const itemValues = matchingItems.map((item) => itemValue(item, key));
    const itemTotal = itemValues.length && itemValues.every((value) => value !== null)
      ? itemValues.reduce((sum, value) => sum + value, 0)
      : null;
    const difference = groupValue !== null && itemTotal !== null
      ? groupValue - itemTotal
      : null;
    return {
      field: key,
      label,
      groupValue,
      itemTotal,
      difference,
      matches: difference !== null && Math.abs(difference) < 0.005,
    };
  });
  return {
    checks,
    matches: matchingItems.length > 0 && checks.every((check) => check.matches),
    matchingItemCount: matchingItems.length,
  };
}

export function detectMixedRates(items) {
  const rates = [...new Set((Array.isArray(items) ? items : [])
    .map((item) => toNumber(item?.["IGST Rate (%)"]))
    .filter((value) => value !== null))];
  return { mixed: rates.length > 1, rates };
}

export function checkHeaderIgst(header, items) {
  const headerValue = toNumber(header?.["IGST Total"]);
  const itemValues = (Array.isArray(items) ? items : []).map((item) =>
    toNumber(item?.["IGST Amount"]) ?? toNumber(item?.["Calculated IGST"])
  );
  const itemTotal = itemValues.length && itemValues.every((value) => value !== null)
    ? itemValues.reduce((sum, value) => sum + value, 0)
    : null;
  const difference = headerValue !== null && itemTotal !== null
    ? headerValue - itemTotal
    : null;
  return {
    headerValue,
    itemTotal,
    difference,
    matches: difference !== null && Math.abs(difference) < 0.005,
  };
}
