import "./eway-redesign.css";
import { state } from "./state.js";
import { buildNicBulkJson } from "./eway-json.js";
import {
  displayValue,
  formatMoney,
  formatQuantity,
  formatUqcMappingRows,
  isMissing,
  parseInrAmount,
  toNumber,
} from "./formatters.js";
import {
  checkGroupTotals,
  checkHeaderIgst,
  detectMixedRates,
  matchingGroupItems,
  sumBackendValues,
} from "./eway-audit.js";

const $ = (id) => document.getElementById(id);
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const VEHICLE_PATTERN = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

export function setupEway() {
  $("goto-boe").addEventListener("click", () => { window.location.hash = "/boe"; });
  $("print-eway").addEventListener("click", () => window.print());
  $("ew-distance").addEventListener("input", () => {
    updateValidity();
    validateField($("ew-distance"));
    hidePreviousJson();
  });
  $("generate-json").addEventListener("click", renderJson);
  $("copy-json").addEventListener("click", copyNicJson);
  $("download-json").addEventListener("click", downloadNicJson);

  ["ew-importer-state", "ew-importer-act-state"].forEach((id) => {
    $(id).addEventListener("input", () => { $(id).dataset.userEdited = "true"; });
  });

  document.querySelectorAll("#view-eway input, #view-eway select, #view-eway textarea")
    .forEach((input) => {
      input.addEventListener("input", () => {
        validateField(input);
        if (input.id === "ew-importer-gstin") updateImporterState();
        hidePreviousJson();
      });
      input.addEventListener("change", () => {
        validateField(input);
        if (input.id === "ew-importer-gstin") updateImporterState();
        hidePreviousJson();
      });
    });
}

export function updateEwayForResponse(response) {
  if (!response) return;
  const header = response.header || {};

  document.querySelectorAll('#view-eway [data-source="header"]').forEach((element) => {
    const key = element.dataset.key;
    const value = header[key];
    element.value = isMissing(value) ? "" : String(value);
    element.placeholder = isMissing(value) ? "Not in BOE data" : "";
  });

  $("ew-hawb").value = [header["HAWB No"], header["MAWB No"]]
    .filter((value) => !isMissing(value))
    .map(String)
    .join(" / ");
  $("ew-supplier-gstin").value = "URP";
  $("ew-supplier-state").value = "99";
  $("ew-supplier-act-state").value = "99";

  const invoiceInr = parseInrAmount(header["Invoice Amount"]);
  $("ew-total-invoice-value").value = invoiceInr === null ? "" : String(invoiceInr);

  updateImporterState();
  $("eway-empty").classList.add("hidden");
  $("eway-content").classList.remove("hidden");
  renderStats(response);
  renderBoeDetails(header);
  renderEwayItems();
  renderUnitMapping();
  renderHeaderIgstAudit();
  updateValidity();
  hidePreviousJson();
  validateAllFields();
}

export function renderEway() {
  if (state.latest) {
    $("eway-empty").classList.add("hidden");
    $("eway-content").classList.remove("hidden");
    renderStats(state.latest);
    renderBoeDetails(state.latest.header || {});
    renderEwayItems();
    renderUnitMapping();
    renderHeaderIgstAudit();
  } else {
    $("eway-empty").classList.remove("hidden");
    $("eway-content").classList.add("hidden");
  }
}

function renderStats(response) {
  const header = response.header || {};
  const items = Array.isArray(response.items) ? response.items : [];
  const groups = Array.isArray(response.grouped) ? response.grouped : [];
  const assessable = sumBackendValues(items, "Assessable Value (CIF INR)");
  const bcd = sumBackendValues(items, "BCD Amount");
  const sws = sumBackendValues(items, "SWS Amount");
  const taxable = sumBackendValues(groups, "GST Taxable Value (for E-Way)");
  const groupedIgst = sumBackendValues(groups, "Calculated IGST");
  const itemIgst = sumBackendValues(items, "IGST Amount");
  const headerIgst = toNumber(header["IGST Total"]);
  const consignment = taxable !== null && groupedIgst !== null
    ? taxable + groupedIgst
    : null;

  const stats = [
    {
      label: "Assessable value",
      value: assessable,
      source: "Sum of item lines · Assessable Value (CIF INR)",
    },
    {
      label: "Customs duty · BCD + SWS",
      value: bcd !== null && sws !== null ? bcd + sws : null,
      source: "Sum of item lines · BCD Amount + SWS Amount",
    },
    {
      label: "E-Way taxable value",
      value: taxable,
      source: "Sum of backend grouped[] taxable values",
      primary: true,
    },
    {
      label: "IGST reconciliation",
      value: headerIgst,
      secondaryValue: itemIgst,
      source: "Header IGST Total vs sum of item-line IGST",
      warning: headerIgst === null || itemIgst === null
        || Math.abs(headerIgst - itemIgst) >= 0.005,
    },
    {
      label: "Total consignment value",
      value: consignment,
      source: "Sum of grouped taxable value + grouped Calculated IGST",
      primary: true,
    },
  ];

  $("eway-stats").innerHTML = stats.map((stat) => {
    const value = stat.value === null ? "Not in BOE data" : formatMoney(stat.value);
    const secondary = stat.label === "IGST reconciliation"
      ? '<div class="eway-stat-source">Item-line sum: <span class="mono">'
        + escapeHtml(itemIgst === null ? "Not in BOE data" : formatMoney(itemIgst))
        + '</span></div>'
      : "";
    return '<article class="eway-stat'
      + (stat.primary ? " is-primary" : "")
      + (stat.warning ? " is-warning" : "")
      + '"><span class="eway-stat-label">' + escapeHtml(stat.label) + '</span>'
      + '<strong class="eway-stat-value">' + escapeHtml(value) + '</strong>'
      + '<div class="eway-stat-source">' + escapeHtml(stat.source) + '</div>'
      + secondary + '</article>';
  }).join("");

  $("eway-total-consignment").textContent = consignment === null
    ? "Not in BOE data"
    : "₹" + formatMoney(consignment);
}

function renderBoeDetails(header) {
  const fields = [
    ["BOE Number", "BOE number"],
    ["BOE Date", "BOE date"],
    ["Port Code", "Port code"],
    ["Mode", "Mode of arrival"],
    ["Invoice Number", "Invoice number"],
    ["Invoice Date", "Invoice date"],
    ["Importer Name", "Importer name"],
    ["Importer GSTIN", "Importer GSTIN"],
    ["Supplier Name", "Supplier name"],
    ["Supplier Address", "Supplier address"],
    ["HAWB No", "HAWB"],
    ["MAWB No", "MAWB"],
    ["Gross Weight (KGS)", "Gross weight"],
    ["Total Items Count", "Item count"],
  ];
  $("eway-boe-details").innerHTML = fields.map(([key, label]) =>
    '<div class="eway-meta-cell"><dt>' + escapeHtml(label) + '</dt><dd'
      + (/(Number|GSTIN|Code|Weight|Count|HAWB|MAWB)/i.test(key) ? ' class="mono"' : '')
      + '>' + escapeHtml(displayValue(header[key])) + '</dd></div>'
  ).join("");
}

function renderEwayItems() {
  if (!state.latest) return;
  const groups = Array.isArray(state.latest.grouped) ? state.latest.grouped : [];
  const items = Array.isArray(state.latest.items) ? state.latest.items : [];
  $("eway-group-count").textContent = groups.length + (groups.length === 1 ? " group" : " groups");

  $("eway-items").innerHTML = groups.map((group, index) => {
    const matchingItems = matchingGroupItems(group, items);
    const groupAudit = checkGroupTotals(group, items);
    const rateResult = detectMixedRates(matchingItems);
    const rateState = state.ewayRates[index] || {};
    const rateValue = rateResult.mixed
      ? (rateState.rate ?? "")
      : (rateResult.rates.length === 1 ? String(rateResult.rates[0]) : "");
    const confirmationChecked = state.ewayRateConfirmations[index] === true;
    const rateDetails = rateResult.rates.length
      ? "Underlying item rates: " + rateResult.rates.map((rate) => formatRateText(rate)).join(", ")
      : "IGST rate not in item data";
    const rateControls = rateResult.mixed
      ? '<div class="eway-rate-detail">' + escapeHtml(rateDetails) + '</div>'
        + '<label class="eway-rate-confirm" for="eway-confirm-rate-' + index + '">'
        + '<input id="eway-confirm-rate-' + index + '" type="checkbox" data-confirm-rate="' + index + '"'
        + (confirmationChecked ? " checked" : "") + '>'
        + '<span>Confirm the rate entered for this combined group</span></label>'
      : '<div class="eway-rate-detail">' + escapeHtml(rateDetails) + '</div>';
    const rateInput = '<label for="eway-rate-' + index + '">IGST rate (%)</label>'
      + '<input id="eway-rate-' + index + '" data-rate-index="' + index + '" inputmode="decimal" value="'
      + escapeHtml(rateValue) + '" placeholder="' + (rateResult.mixed ? "Mixed rates — confirm" : "Not in BOE data")
      + '"' + (rateResult.mixed ? "" : " readonly") + '>';
    const auditTag = groupAudit.matches
      ? '<span class="eway-audit-tag match">MATCH</span>'
      : '<span class="eway-audit-tag differs">DIFFERS</span>';
    const auditDetails = groupAudit.checks.map((check) => {
      const difference = check.difference === null
        ? "difference unavailable (missing source value)"
        : "difference " + formatMoney(check.difference);
      return check.label + ": " + difference;
    }).join(" · ");

    return '<tr tabindex="0" aria-label="Grouped line ' + (index + 1) + '">'
      + '<td class="mono">' + escapeHtml(displayValue(group["HSN Code"])) + '</td>'
      + '<td class="mono">' + escapeHtml(displayValue(group.UQC)) + '</td>'
      + '<td class="num mono">' + escapeHtml(displayQuantity(group.Quantity)) + '</td>'
      + '<td class="num mono">' + escapeHtml(displayMoney(group["GST Taxable Value (for E-Way)"])) + '</td>'
      + '<td class="num mono">' + escapeHtml(displayMoney(group["Calculated IGST"])) + '</td>'
      + '<td class="rate-cell"><div class="field">' + rateInput + '</div>' + rateControls
      + '<div class="eway-audit' + (groupAudit.matches ? "" : " is-diff") + '" role="status">'
      + auditTag + '<span>' + escapeHtml(auditDetails) + '</span></div></td></tr>';
  }).join("") || '<tr><td colspan="6" class="empty">No backend grouped[] lines are available.</td></tr>';

  const quantityTotal = sumBackendValues(groups, "Quantity");
  const taxableTotal = sumBackendValues(groups, "GST Taxable Value (for E-Way)");
  const igstTotal = sumBackendValues(groups, "Calculated IGST");
  $("eway-items-foot").innerHTML = groups.length
    ? '<tr><th colspan="2">Sum of backend grouped lines</th>'
      + '<th class="num mono">' + escapeHtml(displayQuantity(quantityTotal)) + '</th>'
      + '<th class="num mono">' + escapeHtml(displayMoney(taxableTotal)) + '</th>'
      + '<th class="num mono">' + escapeHtml(displayMoney(igstTotal)) + '</th><th></th></tr>'
    : "";

  $("eway-items").querySelectorAll("[data-rate-index]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.rateIndex);
      state.ewayRates[index] = {
        rate: input.value,
        confirmed: state.ewayRateConfirmations[index] === true,
      };
      hidePreviousJson();
    });
  });
  $("eway-items").querySelectorAll("[data-confirm-rate]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const index = Number(checkbox.dataset.confirmRate);
      state.ewayRateConfirmations[index] = checkbox.checked;
      state.ewayRates[index] = {
        rate: $("eway-rate-" + index)?.value.trim() || "",
        confirmed: checkbox.checked,
      };
      hidePreviousJson();
    });
  });
}

function renderHeaderIgstAudit() {
  const audit = checkHeaderIgst(state.latest?.header || {}, state.latest?.items || []);
  const tag = audit.matches
    ? '<span class="eway-audit-tag match">MATCH</span>'
    : '<span class="eway-audit-tag differs">DIFFERS</span>';
  const difference = audit.difference === null
    ? "Difference unavailable because a source value is missing."
    : "Difference (header − item sum): " + formatMoney(audit.difference);
  $("eway-header-igst-check").classList.toggle("is-diff", !audit.matches);
  $("eway-header-igst-check").innerHTML = tag
    + '<strong>Header IGST total vs sum of item-line IGST</strong><div class="small">'
    + escapeHtml("Header: " + displayMoney(audit.headerValue) + " · Item sum: " + displayMoney(audit.itemTotal))
    + '</div><div class="small">' + escapeHtml(difference) + '</div>';
  $("eway-igst-check").textContent = audit.matches
    ? "Header IGST total matches the sum of item-line IGST."
    : "Header IGST total does not match, or cannot be reconciled with, the sum of item-line IGST.";
  $("eway-igst-check").classList.toggle("is-diff", !audit.matches);
}

function renderUnitMapping() {
  const rows = formatUqcMappingRows(state.latest?.grouped || []);
  $("eway-unit-mapping").innerHTML = '<h3 id="eway-mapping-heading">UQC → NIC unit-code mapping</h3>'
    + '<p class="small muted">Only known codes in the current mapping table are filled. Unknown units stay empty and are warned about in JSON validation.</p>'
    + '<div class="tablewrap"><table class="data"><thead><tr><th scope="col">BOE UQC</th>'
    + '<th scope="col">NIC qtyUnit</th><th scope="col">Mapping status</th></tr></thead><tbody>'
    + rows.map((row) => '<tr tabindex="0"><td class="mono">' + escapeHtml(displayValue(row.uqc))
      + '</td><td class="mono">' + escapeHtml(row.nicCode || "Not mapped")
      + '</td><td>' + (row.known
        ? '<span class="status">Mapped</span>'
        : '<span class="status error">Unknown — not guessed</span>')
      + '</td></tr>').join("")
    + '</tbody></table></div>';
}

function updateImporterState() {
  const gstin = $("ew-importer-gstin").value.trim().toUpperCase();
  const valid = GSTIN_PATTERN.test(gstin);
  if (valid && !$("ew-importer-state").dataset.userEdited) {
    $("ew-importer-state").value = gstin.slice(0, 2);
    if (!$("ew-importer-act-state").dataset.userEdited) {
      $("ew-importer-act-state").value = gstin.slice(0, 2);
    }
  } else if (!valid && !$("ew-importer-state").dataset.userEdited) {
    $("ew-importer-state").value = "";
    if (!$("ew-importer-act-state").dataset.userEdited) {
      $("ew-importer-act-state").value = "";
    }
  }
}

function updateValidity() {
  const raw = $("ew-distance").value.trim();
  const distance = raw === "" ? null : Number(raw);
  $("ew-validity").value = Number.isFinite(distance) && distance > 0
    ? Math.ceil(distance / 200) + (Math.ceil(distance / 200) === 1 ? " day" : " days")
    : "";
}

function readForm() {
  const value = (id) => $(id).value.trim();
  return {
    userGstin: value("ew-user-gstin"),
    supplyType: value("eway-supply"),
    subSupplyType: value("eway-subtype"),
    docType: value("eway-doctype"),
    docNo: value("ew-docno"),
    docDate: value("ew-docdate"),
    fromGstin: value("ew-supplier-gstin"),
    fromTrdName: value("ew-supplier-name"),
    fromAddr1: value("ew-supplier-address"),
    fromPlace: value("ew-from-place"),
    fromPincode: value("ew-from-pincode"),
    fromStateCode: value("ew-supplier-state"),
    actualFromStateCode: value("ew-supplier-act-state"),
    toGstin: value("ew-importer-gstin"),
    toTrdName: value("ew-importer-name"),
    toAddr1: value("ew-to-address"),
    toPlace: value("ew-to-place"),
    toPincode: value("ew-pincode"),
    toStateCode: value("ew-importer-state"),
    actualToStateCode: value("ew-importer-act-state"),
    transactionType: value("eway-transaction"),
    totalInvoiceValue: value("ew-total-invoice-value"),
    cgstValue: value("ew-cgst-value"),
    sgstValue: value("ew-sgst-value"),
    cessValue: value("ew-cess-value"),
    transMode: value("ew-transport-mode"),
    transDistance: value("ew-distance"),
    transporterName: value("ew-transporter"),
    transporterId: value("ew-transporter-gstin"),
    transDocNo: value("ew-transport-doc"),
    transDocDate: value("ew-transport-doc-date"),
    vehicleNo: value("ew-vehicle"),
    vehicleType: value("ew-vehicle-type"),
  };
}

function buildCurrent() {
  const confirmedMixedRates = {};
  (state.latest?.grouped || []).forEach((group, index) => {
    const mixed = detectMixedRates(matchingGroupItems(group, state.latest.items || [])).mixed;
    if (mixed) {
      confirmedMixedRates[index] = {
        rate: $("eway-rate-" + index)?.value.trim() || "",
        confirmed: state.ewayRateConfirmations[index] === true,
      };
    }
  });

  const result = buildNicBulkJson({
    response: state.latest,
    form: readForm(),
    confirmedMixedRates,
  });
  const inlineErrors = validateAllFields();
  const extraBlocking = inlineErrors.filter((entry) => entry.blocking).map((entry) => entry.label);
  const extraWarnings = inlineErrors.map((entry) => entry.message);
  result.blockingErrors = [...new Set([...result.blockingErrors, ...extraBlocking])];
  result.warnings = [...new Set([...result.warnings, ...extraWarnings])];
  result.ready = result.blockingErrors.length === 0;
  return result;
}

function validateAllFields() {
  const results = [];
  document.querySelectorAll('#view-eway [data-validate]').forEach((input) => {
    const message = validateField(input, true);
    if (message) {
      const blocking = !input.value.trim()
        || input.dataset.validate === "gstin"
        || input.dataset.validate === "pincode"
        || input.dataset.validate === "vehicle";
      results.push({
        label: input.labels?.[0]?.textContent || input.id,
        message,
        blocking,
      });
    }
  });

  const required = [
    ["eway-supply", "Supply type"],
    ["eway-subtype", "Sub supply type"],
    ["ew-docno", "Document number"],
    ["ew-docdate", "Document date"],
    ["ew-user-gstin", "Requesting party GSTIN"],
    ["ew-supplier-name", "Supplier name"],
    ["ew-supplier-address", "Supplier address"],
    ["ew-importer-gstin", "Importer GSTIN"],
    ["ew-importer-name", "Importer name"],
    ["ew-from-pincode", "Dispatch pincode"],
    ["ew-pincode", "Ship-to pincode"],
    ["ew-transport-mode", "Transport mode"],
    ["ew-distance", "Transport distance"],
    ["ew-vehicle-type", "Vehicle type"],
    ["ew-transport-doc", "Transport document number"],
    ["ew-transport-doc-date", "Transport document date"],
  ];
  for (const [id, label] of required) {
    const input = $(id);
    if (input && !input.value.trim()) {
      const message = label + " is required.";
      results.push({ label, message, blocking: true });
      showFieldError(input, message);
    }
  }
  return results;
}

function validateField(input, silent = false) {
  if (!input?.dataset.validate) return "";
  const value = input.value.trim().toUpperCase();
  let message = "";
  if (!value) {
    if (input.dataset.validate === "gstin" || input.dataset.validate === "pincode"
      || input.dataset.validate === "vehicle") {
      message = "Required field.";
    }
  } else if (input.dataset.validate === "gstin" && !GSTIN_PATTERN.test(value)) {
    message = "Enter a valid 15-character GSTIN.";
  } else if (input.dataset.validate === "supplier-gstin" && value !== "URP" && !GSTIN_PATTERN.test(value)) {
    message = "Enter a valid GSTIN or URP for an unregistered supplier.";
  } else if (input.dataset.validate === "pincode" && !/^[1-9][0-9]{5}$/.test(value)) {
    message = "Enter a valid 6-digit pincode.";
  } else if (input.dataset.validate === "vehicle" && !VEHICLE_PATTERN.test(value.replace(/[\s-]/g, ""))) {
    message = "Enter a valid vehicle registration number.";
  } else if (input.dataset.validate === "transporter" && !/^[0-9A-Z]{15}$/.test(value)) {
    message = "Enter a 15-character GSTIN / TRANSIN.";
  }
  if (!silent) showFieldError(input, message);
  return message;
}

function showFieldError(input, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  const error = $("error-" + input.id);
  if (error) error.textContent = message;
}

function renderJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
  $("eway-json-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function copyNicJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
  if (!result.ready) return;
  await copyText(JSON.stringify(result.json, null, 2), $("copy-json"));
}

function downloadNicJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
  if (!result.ready) return;

  const blob = new Blob([JSON.stringify(result.json, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "BOE_FLOW_NIC_EWAY_BULK.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showWarnings(warnings, blockingErrors) {
  const panel = $("eway-warnings");
  const allWarnings = [...new Set(warnings)];
  if (!allWarnings.length) {
    panel.classList.add("hidden");
    panel.textContent = "";
    return;
  }
  panel.classList.remove("hidden");
  panel.classList.toggle("error", blockingErrors.length > 0);
  panel.innerHTML = '<strong>' + (blockingErrors.length
    ? "Download blocked — resolve required fields"
    : "Review these warnings") + '</strong><ul>'
    + allWarnings.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("")
    + "</ul>"
    + (blockingErrors.length
      ? '<p class="small">Blocking fields: ' + escapeHtml(blockingErrors.join(", ")) + "</p>"
      : "");
}

function hidePreviousJson() {
  if ($("eway-json")) {
    $("eway-json").textContent = "Form or BOE values changed. Generate JSON again to refresh the preview and validation.";
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1300);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("aria-label", "JSON to copy");
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function displayMoney(value) {
  return isMissing(value) || toNumber(value) === null
    ? "Not in BOE data"
    : "₹" + formatMoney(value);
}

function displayQuantity(value) {
  return isMissing(value) || toNumber(value) === null
    ? "Not in BOE data"
    : formatQuantity(value);
}

function formatRateText(value) {
  return String(value) + "%";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
