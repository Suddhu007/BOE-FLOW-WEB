export function isMissing(value) {
  return value === null
    || value === undefined
    || String(value).trim() === ""
    || String(value).trim().toUpperCase() === "N/A";
}

export function displayValue(value, missingLabel = "Not in BOE data") {
  return isMissing(value) ? missingLabel : String(value);
}

export function toNumber(value) {
  if (isMissing(value) || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatMoney(value) {
  const number = toNumber(value);
  return number === null
    ? "—"
    : number.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
}

export function formatQuantity(value) {
  const number = toNumber(value);
  return number === null ? "—" : number.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

export function formatRate(value) {
  const number = toNumber(value);
  return number === null ? "—" : number.toLocaleString("en-IN", { maximumFractionDigits: 4 }) + "%";
}

export function sumKnown(values) {
  const numbers = values.map(toNumber);
  if (!numbers.length || numbers.some((number) => number === null)) return null;
  return numbers.reduce((sum, number) => sum + number, 0);
}

export function checkGroupedTotals(items, grouped, fields = [
  "Quantity",
  "Assessable Value (CIF INR)",
  "GST Taxable Value (for E-Way)",
  "Calculated IGST",
]) {
  return fields.map((field) => {
    const itemTotal = sumKnown(items.map((item) => item[field]));
    const groupedTotal = sumKnown(grouped.map((item) => item[field]));
    return {
      field,
      itemTotal,
      groupedTotal,
      matches: itemTotal !== null && groupedTotal !== null && Math.abs(itemTotal - groupedTotal) < 0.011,
    };
  });
}

// Codes below are from the NIC E-Way Bill master-code list. Alias conversion is
// deliberately limited to entries whose meaning is unambiguous; unknown units stay blank.
export const NIC_UNIT_CODES = Object.freeze({
  BAG: "BAG", BAL: "BAL", BDL: "BDL", BKL: "BKL", BOU: "BOU", BOX: "BOX",
  BTL: "BTL", BUN: "BUN", CAN: "CAN", CBM: "CBM", CCM: "CCM", CMS: "CMS",
  CTN: "CTN", DOZ: "DOZ", DRM: "DRM", GGK: "GGK", GMS: "GMS", GRS: "GRS",
  GYD: "GYD", KGS: "KGS", KLR: "KLR", KME: "KME", LTR: "LTR", MTR: "MTR",
  MLT: "MLT", MTS: "MTS", NOS: "NOS", OTH: "OTH", PAC: "PAC", PCS: "PCS",
  PRS: "PRS", QTL: "QTL", ROL: "ROL", SET: "SET", SQF: "SQF", SQM: "SQM",
  SQY: "SQY", TBS: "TBS", TGM: "TGM", THD: "THD", TON: "TON", TUB: "TUB",
  UGS: "UGS", UNT: "UNT", YDS: "YDS",
});

export function mapUqcToNic(value) {
  if (isMissing(value)) return "";
  const normalized = String(value).trim().toUpperCase();
  return NIC_UNIT_CODES[normalized] || "";
}

export function formatNicDate(value) {
  if (isMissing(value)) return "";
  const source = String(value).trim();
  let match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (isValidDate(day, month, year)) return pad(day) + "/" + pad(month) + "/" + year;
    return "";
  }
  match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDate(day, month, year)) return pad(day) + "/" + pad(month) + "/" + year;
  }
  const parsed = new Date(source);
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(source)) {
    return pad(parsed.getDate()) + "/" + pad(parsed.getMonth() + 1) + "/" + parsed.getFullYear();
  }
  return "";
}

function isValidDate(day, month, year) {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function parseInrAmount(value) {
  if (isMissing(value)) return null;
  const source = String(value).trim();
  if (!/\bINR\b|₹/i.test(source)) return null;
  const numeric = source.replace(/INR|₹/gi, "").replace(/,/g, "").trim();
  const amount = Number(numeric);
  return Number.isFinite(amount) ? amount : null;
}

export function formatUqcMappingRows(grouped) {
  return grouped.map((record) => ({
    uqc: isMissing(record.UQC) ? "" : String(record.UQC).trim().toUpperCase(),
    nicCode: mapUqcToNic(record.UQC),
    known: Boolean(mapUqcToNic(record.UQC)),
  }));
}
