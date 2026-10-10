import {
  formatNicDate,
  isMissing,
  mapUqcToNic,
  parseInrAmount,
  toNumber,
} from "./formatters.js";

// NIC's official bulk-generation attributes and sample JSON pack was marked
// updated 17/06/2021. Its downloadable workbook could not be fetched directly
// during this implementation, so the exact wrapper/version must be rechecked
// against the current portal template before production use.
export const NIC_BULK_TEMPLATE = Object.freeze({
  version: "1.0.0621",
  updated: "17/06/2021",
});

function numericInput(value) {
  if (isMissing(value)) return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanString(value) {
  return isMissing(value) ? "" : String(value).trim();
}

function findGroupedItemLines(group, items) {
  return items.filter((item) =>
    String(item["HSN Code"] ?? "").trim() === String(group["HSN Code"] ?? "").trim()
    && String(item.UQC ?? "").trim().toUpperCase() === String(group.UQC ?? "").trim().toUpperCase()
  );
}

function groupedNumberTotal(groups, field) {
  const numbers = groups.map((group) => toNumber(group[field]));
  if (!numbers.length || numbers.some((value) => value === null)) return null;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function hsnAsNumber(value) {
  if (isMissing(value)) return null;
  const digits = String(value).trim().replace(/\./g, "");
  return /^\d{4,8}$/.test(digits) ? Number(digits) : null;
}

function pickUniqueDescription(itemLines) {
  const descriptions = [...new Set(itemLines
    .map((item) => cleanString(item.Description))
    .filter(Boolean))];
  return descriptions.length === 1 ? descriptions[0] : "";
}

function uniqueRate(itemLines) {
  const rates = [...new Set(itemLines
    .map((item) => toNumber(item["IGST Rate (%)"]))
    .filter((rate) => rate !== null))];
  return rates;
}

function rateBreakdown(itemLines) {
  return itemLines.map((item) => ({
    itemNo: cleanString(item["Item No"]) || "Not in BOE data",
    rate: toNumber(item["IGST Rate (%)"]),
    amount: toNumber(item["Calculated IGST"]) ?? toNumber(item["IGST Amount"]),
  }));
}

function pushWarning(warnings, message) {
  if (!warnings.includes(message)) warnings.push(message);
}

function requiredNumber(value, label, warnings, errors) {
  const number = numericInput(value);
  if (number === null) {
    pushWarning(warnings, label + " is missing or invalid; enter a verified value.");
    errors.push(label);
  }
  return number;
}

export function buildNicBulkJson({ response, form, confirmedMixedRates = {} }) {
  const warnings = [];
  const blockingErrors = [];
  const header = response?.header || {};
  const groups = Array.isArray(response?.grouped) ? response.grouped : [];
  const items = Array.isArray(response?.items) ? response.items : [];

  if (!groups.length) {
    blockingErrors.push("No backend grouped[] lines are available.");
    warnings.push("No backend grouped[] lines are available; process a BOE before exporting.");
  }

  const userGstin = cleanString(form.userGstin);
  const fromGstin = cleanString(form.fromGstin);
  const toGstin = cleanString(form.toGstin);
  if (!userGstin) {
    blockingErrors.push("User GSTIN");
    warnings.push("User GSTIN is required by the NIC bulk template.");
  }
  if (!fromGstin) {
    blockingErrors.push("From GSTIN");
    warnings.push("From GSTIN is required; use URP only if the supplier is unregistered.");
  }
  if (!toGstin) {
    blockingErrors.push("To GSTIN");
    warnings.push("To GSTIN is missing; verify importer GSTIN against the BOE.");
  }

  const docDate = formatNicDate(form.docDate || header["BOE Date"]);
  if (!docDate) {
    blockingErrors.push("Document date");
    warnings.push("Document date is missing or ambiguous. Enter a verified date in dd/mm/yyyy format.");
  }

  const fromPincode = requiredNumber(form.fromPincode, "From pincode", warnings, blockingErrors);
  const fromStateCode = requiredNumber(form.fromStateCode, "From state code", warnings, blockingErrors);
  const actualFromStateCode = requiredNumber(form.actualFromStateCode, "Actual from state code", warnings, blockingErrors);
  const toPincode = requiredNumber(form.toPincode, "To pincode", warnings, blockingErrors);
  const toStateCode = requiredNumber(form.toStateCode, "To state code", warnings, blockingErrors);
  const actualToStateCode = requiredNumber(form.actualToStateCode, "Actual to state code", warnings, blockingErrors);
  const transDistance = numericInput(form.transDistance);
  if (transDistance === null || transDistance < 0 || transDistance > 4000) {
    blockingErrors.push("Transport distance");
    warnings.push("Transport distance is required and must be from 0 to 4000 km.");
  }

  const totalValue = groupedNumberTotal(groups, "GST Taxable Value (for E-Way)");
  const igstValue = groupedNumberTotal(groups, "Calculated IGST");
  if (totalValue === null) {
    blockingErrors.push("Grouped taxable value");
    warnings.push("At least one backend grouped taxable value is missing; NIC JSON was not made upload-ready.");
  }
  if (igstValue === null) {
    blockingErrors.push("Grouped calculated IGST");
    warnings.push("At least one backend grouped Calculated IGST value is missing; resolve before exporting.");
  }

  const totalInvoiceValue = numericInput(form.totalInvoiceValue);
  if (totalInvoiceValue === null) {
    blockingErrors.push("Total invoice value");
    warnings.push("Total invoice value including taxes/charges is not safely available as an INR number. Enter the verified INR total.");
  }

  const optionalTopLevelAmounts = [
    ["cgstValue", form.cgstValue, "CGST value"],
    ["sgstValue", form.sgstValue, "SGST value"],
    ["cessValue", form.cessValue, "Cess value"],
  ];
  const taxAmounts = {};
  for (const [key, value, label] of optionalTopLevelAmounts) {
    if (isMissing(value)) {
      pushWarning(warnings, label + " was not supplied by the BOE response; the JSON leaves it out instead of assuming zero.");
    } else {
      const amount = numericInput(value);
      if (amount === null) {
        pushWarning(warnings, label + " is invalid and has been omitted.");
      } else {
        taxAmounts[key] = amount;
      }
    }
  }

  const itemList = groups.map((group, index) => {
    const matchingItems = findGroupedItemLines(group, items);
    const description = pickUniqueDescription(matchingItems);
    if (!description) {
      pushWarning(warnings, "Product name for group " + (index + 1) + " (HSN " + cleanString(group["HSN Code"]) + " / UQC " + cleanString(group.UQC) + ") is missing or has multiple descriptions.");
    }

    const unitCode = mapUqcToNic(group.UQC);
    if (!unitCode) {
      pushWarning(warnings, "No confirmed NIC unit mapping for UQC "" + cleanString(group.UQC) + "" in group " + (index + 1) + "; qtyUnit will be empty.");
    }

    const hsnCode = hsnAsNumber(group["HSN Code"]);
    if (hsnCode === null) {
      pushWarning(warnings, "HSN code for group " + (index + 1) + " is missing or not numeric; enter a verified HSN before upload.");
      blockingErrors.push("HSN code group " + (index + 1));
    }

    const quantity = toNumber(group.Quantity);
    if (quantity === null) {
      pushWarning(warnings, "Quantity for group " + (index + 1) + " is missing from backend grouped[].");
      blockingErrors.push("Quantity group " + (index + 1));
    }

    const taxableAmount = toNumber(group["GST Taxable Value (for E-Way)"]);
    const igstAmount = toNumber(group["Calculated IGST"]);
    if (taxableAmount === null || igstAmount === null) {
      blockingErrors.push("Grouped amounts for group " + (index + 1));
      pushWarning(warnings, "Backend taxable value or Calculated IGST is missing for group " + (index + 1) + ".");
    }

    const rates = uniqueRate(matchingItems);
    let igstRate = null;
    if (rates.length === 1) {
      igstRate = rates[0];
    } else if (rates.length > 1) {
      const confirmation = confirmedMixedRates[index];
      const confirmedRate = confirmation?.confirmed === true
        ? numericInput(confirmation.rate)
        : null;
      pushWarning(
        warnings,
        "Mixed IGST rates for group " + (index + 1) + " (HSN " + cleanString(group["HSN Code"]) + " / UQC " + cleanString(group.UQC) + "): review the underlying item rates and explicitly confirm or split the group."
      );
      if (confirmedRate !== null) {
        igstRate = confirmedRate;
      } else {
        blockingErrors.push("Confirm or split mixed IGST rate group " + (index + 1));
      }
    } else {
      pushWarning(warnings, "IGST rate is not available for group " + (index + 1) + ".");
      blockingErrors.push("IGST rate group " + (index + 1));
    }

    const entry = {
      productName: description,
      hsnCode: hsnCode,
      quantity: quantity,
      qtyUnit: unitCode,
      taxableAmount: taxableAmount,
    };
    if (igstRate !== null) entry.igstRate = igstRate;

    // The BOE API contract currently exposes only IGST for GST. NIC item fields
    // for CGST/SGST/cess are omitted unless a verified value is available.
    const sourceRateKeys = [
      ["cgstRate", "CGST Rate (%)"],
      ["sgstRate", "SGST Rate (%)"],
      ["cessRate", "Cess Rate (%)"],
    ];
    for (const [target, source] of sourceRateKeys) {
      const values = matchingItems.map((item) => toNumber(item[source])).filter((value) => value !== null);
      const distinct = [...new Set(values)];
      if (distinct.length === 1) entry[target] = distinct[0];
      else if (distinct.length > 1) {
        pushWarning(warnings, "Mixed " + source + " values in group " + (index + 1) + "; field omitted for manual review.");
      }
    }

    // This is included for audit/debug in the on-screen group details, never in
    // the NIC schema object.
    return { ...entry, _audit: { rates: rates, rateBreakdown: rateBreakdown(matchingItems) } };
  });

  const fromAddr1 = cleanString(form.fromAddr1);
  const toAddr1 = cleanString(form.toAddr1);
  const fromPlace = cleanString(form.fromPlace);
  const toPlace = cleanString(form.toPlace);
  const vehicleNo = cleanString(form.vehicleNo);
  const transporterId = cleanString(form.transporterId);
  const transDocNo = cleanString(form.transDocNo);
  const transDocDate = formatNicDate(form.transDocDate);
  const transMode = cleanString(form.transMode);
  const vehicleType = cleanString(form.vehicleType);

  if (!fromAddr1) pushWarning(warnings, "From address line 1 is empty; fill it if required by the current NIC template.");
  if (!fromPlace) pushWarning(warnings, "From place is not available; enter a verified place.");
  if (!toAddr1) pushWarning(warnings, "To address line 1 is not available in the BOE response; enter the verified importer/ship-to address.");
  if (!toPlace) pushWarning(warnings, "To place is not available in the BOE response; enter a verified place.");
  if (vehicleNo && vehicleNo.length < 7) pushWarning(warnings, "Vehicle number is shorter than the NIC schema's usual minimum; verify it.");
  if (transporterId && transporterId !== "URP" && !/^\d{2}[0-9A-Z]{13}$/.test(transporterId)) {
    pushWarning(warnings, "Transporter ID does not match the 15-character GSTIN/TRANSIN pattern.");
  }
  if (transDocNo && transDocNo.length > 15) pushWarning(warnings, "Transport document number exceeds 15 characters.");
  if (transDocDate && docDate && parseDateKey(transDocDate) < parseDateKey(docDate)) {
    pushWarning(warnings, "Transport document date is earlier than the BOE document date; verify NIC's date validation.");
  }
  if (!transMode) {
    blockingErrors.push("Transport mode");
    warnings.push("Select a transport mode using the NIC code: road 1, rail 2, air 3 or ship 4.");
  }
  if (!vehicleType) pushWarning(warnings, "Vehicle type was not selected; NIC normally uses R or O.");

  const bill = {
    userGstin: userGstin,
    supplyType: cleanString(form.supplyType),
    subSupplyType: cleanString(form.subSupplyType),
    docType: cleanString(form.docType),
    docNo: cleanString(form.docNo || header["BOE Number"]),
    docDate: docDate,
    fromGstin: fromGstin,
    fromTrdName: cleanString(form.fromTrdName || header["Supplier Name"]),
    fromAddr1: fromAddr1,
    fromPlace: fromPlace,
    fromPincode: fromPincode,
    fromStateCode: fromStateCode,
    actualFromStateCode: actualFromStateCode,
    toGstin: toGstin,
    toTrdName: cleanString(form.toTrdName || header["Importer Name"]),
    toAddr1: toAddr1,
    toPlace: toPlace,
    toPincode: toPincode,
    toStateCode: toStateCode,
    actualToStateCode: actualToStateCode,
    transType: numericInput(form.transactionType),
    totalValue: totalValue,
    igstValue: igstValue,
    transMode: transMode,
    transDistance: transDistance === null ? "" : String(transDistance),
    transporterName: cleanString(form.transporterName),
    transporterId: transporterId,
    transDocNo: transDocNo,
    vehicleNo: vehicleNo,
    vehicleType: vehicleType,
    totInvValue: totalInvoiceValue,
    itemList: itemList.map(({ _audit, ...item }) => item),
    ...taxAmounts,
  };

  if (!bill.docNo) {
    blockingErrors.push("Document number");
    warnings.push("Document number is missing.");
  }
  if (!bill.supplyType || !bill.subSupplyType || !bill.docType) {
    blockingErrors.push("Supply type / subtype / document type");
    warnings.push("Supply type, sub supply type and document type must use NIC master codes.");
  }
  if (![1, 2, 3, 4].includes(bill.transType)) {
    blockingErrors.push("Transaction type");
    warnings.push("Transaction type must be a NIC code from 1 to 4.");
  }
  if (!["1", "2", "3", "4"].includes(transMode)) {
    blockingErrors.push("Transport mode");
    warnings.push("Transport mode must be one of NIC codes 1, 2, 3 or 4.");
  }
  if (!["R", "O"].includes(vehicleType)) {
    pushWarning(warnings, "Vehicle type must be NIC code R or O when vehicle details apply.");
  }

  // NIC bulk generation wrapper uses version + billLists. The currently
  // documented developer API v1.03 has a different encrypted request wrapper.
  const json = {
    version: NIC_BULK_TEMPLATE.version,
    billLists: [bill],
  };

  return {
    json,
    warnings,
    blockingErrors: [...new Set(blockingErrors)],
    ready: blockingErrors.length === 0,
    totals: { totalValue: totalValue, igstValue: igstValue },
    audit: {
      groups: groups.map((group, index) => ({
        hsnCode: group["HSN Code"],
        uqc: group.UQC,
        quantity: group.Quantity,
        taxableAmount: group["GST Taxable Value (for E-Way)"],
        igstAmount: group["Calculated IGST"],
        matchingItemRates: itemList[index]?._audit?.rates || [],
        itemRateBreakdown: itemList[index]?._audit?.rateBreakdown || [],
        nicUnitCode: itemList[index]?.qtyUnit || "",
      })),
    },
  };
}

function parseDateKey(value) {
  const parts = String(value).split("/");
  return Number(parts[2] + parts[1] + parts[0]);
}

// The formatter is used here so tests can separately check an INR header amount.
// Exported for unit tests; builder intentionally requires an explicit user value.
export { parseInrAmount };
