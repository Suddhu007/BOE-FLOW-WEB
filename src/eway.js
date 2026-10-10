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

const $ = (id) => document.getElementById(id);

export function setupEway() {
  $("goto-boe").addEventListener("click", () => { window.location.hash = "/boe"; });
  $("print-eway").addEventListener("click", () => window.print());
  $("ew-distance").addEventListener("input", updateValidity);
  $("generate-json").addEventListener("click", renderJson);
  $("copy-json").addEventListener("click", copyNicJson);
  $("download-json").addEventListener("click", downloadNicJson);

  const importerGstin = $("ew-importer-gstin");
  importerGstin.addEventListener("input", () => {
    const value = importerGstin.value.trim();
    if (!isMissing(value) && /^\d{2}/.test(value)) {
      if (!$("ew-importer-state").dataset.userEdited) $("ew-importer-state").value = value.slice(0, 2);
      if (!$("ew-importer-act-state").dataset.userEdited) $("ew-importer-act-state").value = value.slice(0, 2);
    }
  });

  ["ew-importer-state", "ew-importer-act-state", "ew-supplier-state", "ew-supplier-act-state"].forEach((id) => {
    $(id).addEventListener("input", () => { $(id).dataset.userEdited = "true"; });
  });

  ["ew-total-invoice-value", "ew-cgst-value", "ew-sgst-value", "ew-cess-value"].forEach((id) => {
    $(id).addEventListener("input", hidePreviousJson);
  });
}

export function updateEwayForResponse(response) {
  if (!response) return;
  const header = response.header || {};
  document.querySelectorAll('[data-source="header"]').forEach((element) => {
    const key = element.dataset.key;
    element.value = isMissing(header[key]) ? "" : String(header[key]);
  });

  $("ew-user-gstin").value = isMissing(header["Importer GSTIN"]) ? "" : String(header["Importer GSTIN"]);
  $("ew-importer-name").placeholder = isMissing(header["Importer Name"])
    ? "Not in BOE data — enter importer name"
    : "";
  $("ew-importer-state").dataset.userEdited = "";
  $("ew-importer-act-state").dataset.userEdited = "";

  const importerGstin = $("ew-importer-gstin").value.trim();
  if (/^\d{2}/.test(importerGstin)) {
    $("ew-importer-state").value = importerGstin.slice(0, 2);
    $("ew-importer-act-state").value = importerGstin.slice(0, 2);
  } else {
    $("ew-importer-state").value = "";
    $("ew-importer-act-state").value = "";
  }

  const invoiceInr = parseInrAmount(header["Invoice Amount"]);
  $("ew-total-invoice-value").value = invoiceInr === null ? "" : String(invoiceInr);
  $("eway-empty").classList.add("hidden");
  $("eway-content").classList.remove("hidden");
  renderEwayItems();
  renderUnitMapping();
  hidePreviousJson();
}

export function renderEway() {
  if (state.latest) {
    $("eway-empty").classList.add("hidden");
    $("eway-content").classList.remove("hidden");
    renderEwayItems();
  } else {
    $("eway-empty").classList.remove("hidden");
    $("eway-content").classList.add("hidden");
  }
}

function updateValidity() {
  const distance = Number($("ew-distance").value);
  $("ew-validity").value = Number.isFinite(distance) && distance > 0
    ? Math.ceil(distance / 200) + " day(s)"
    : "";
}

function renderEwayItems() {
  if (!state.latest) return;
  const groups = state.latest.grouped || [];
  const items = state.latest.items || [];

  $("eway-items").innerHTML = groups.map((group, index) => {
    const matchingItems = findMatchingItems(group, items);
    const rateRecords = matchingItems.map((item) => ({
      itemNo: item["Item No"],
      rate: toNumber(item["IGST Rate (%)"]),
      amount: toNumber(item["Calculated IGST"]) ?? toNumber(item["IGST Amount"]),
    }));
    const rates = [...new Set(rateRecords.map((record) => record.rate).filter((value) => value !== null))];
    const mixed = rates.length > 1;
    const stored = state.ewayRates[index];
    const rateValue = mixed ? (stored?.rate ?? "") : (rates.length === 1 ? String(rates[0]) : "");
    const rateConfirmed = !mixed || stored?.confirmed === true;
    const detail = mixed
      ? '<div class="rate-details">' + rateRecords.map((record) =>
        '<div>Item ' + escapeHtml(displayValue(record.itemNo, "—")) + ": "
          + escapeHtml(record.rate === null ? "rate unavailable" : String(record.rate) + "%")
          + " · IGST amount " + escapeHtml(formatMoney(record.amount)) + "</div>"
      ).join("") + "</div>"
      : '<div class="small muted">' + (rates.length ? "Rate from item lines" : "No rate in item data") + "</div>";

    const confirmation = mixed
      ? '<label class="rate-confirm"><input type="checkbox" data-confirm-rate="' + index + '"' + (rateConfirmed ? " checked" : "")
        + '> I confirm this rate for the combined group</label><div class="small muted">Or split the HSN/UQC group before export.</div>'
      : '<div class="small muted">Single rate in item lines</div>';

    return "<tr>"
      + "<td>" + escapeHtml(displayValue(group["HSN Code"], "—")) + "</td>"
      + "<td>" + escapeHtml(displayValue(group.UQC, "—")) + "</td>"
      + '<td class="num">' + escapeHtml(formatQuantity(group.Quantity)) + "</td>"
      + '<td class="num">' + escapeHtml(formatMoney(group["GST Taxable Value (for E-Way)"])) + "</td>"
      + '<td class="num">' + escapeHtml(formatMoney(group["Calculated IGST"])) + "</td>"
      + '<td><div class="field"><label for="eway-rate-' + index + '">IGST rate (%)</label>'
      + '<input id="eway-rate-' + index + '" aria-label="IGST rate for group ' + (index + 1) + '" data-rate-index="'
      + index + '" value="' + escapeHtml(rateValue) + '" placeholder="' + (mixed ? "Mixed rates — confirm" : "Rate unavailable")
      + '" inputmode="decimal" ' + (mixed ? "" : "readonly") + '></div>'
      + detail + confirmation + "</td></tr>";
  }).join("") || '<tr><td colspan="6" class="empty">No grouped items found.</td></tr>';

  $("eway-items-foot").innerHTML = groups.length
    ? '<tr><th colspan="2">Backend grouped totals</th><th class="num">'
      + escapeHtml(formatQuantity(sumGroupField(groups, "Quantity"))) + '</th><th class="num">'
      + escapeHtml(formatMoney(sumGroupField(groups, "GST Taxable Value (for E-Way)"))) + '</th><th class="num">'
      + escapeHtml(formatMoney(sumGroupField(groups, "Calculated IGST"))) + "</th><th></th></tr>"
    : "";

  renderIgstConsistencyCheck(groups, items);

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
        rate: $("eway-rate-" + index).value,
        confirmed: checkbox.checked,
      };
      hidePreviousJson();
    });
  });
}

function findMatchingItems(group, items) {
  return items.filter((item) =>
    String(item["HSN Code"] ?? "").trim() === String(group["HSN Code"] ?? "").trim()
    && String(item.UQC ?? "").trim().toUpperCase() === String(group.UQC ?? "").trim().toUpperCase()
  );
}

function renderIgstConsistencyCheck(groups, items) {
  const panel = $("eway-igst-check");
  const groupedTotal = sumGroupField(groups, "Calculated IGST");
  const itemValues = items.map((item) => toNumber(item["Calculated IGST"]));
  const itemTotal = itemValues.length && itemValues.every((value) => value !== null)
    ? itemValues.reduce((sum, value) => sum + value, 0)
    : null;

  panel.classList.remove("hidden");
  if (groupedTotal === null || itemTotal === null) {
    panel.classList.add("error");
    panel.textContent = "IGST consistency check unavailable: one or more item or grouped Calculated IGST values are missing.";
    return;
  }

  const matches = Math.abs(groupedTotal - itemTotal) < 0.011;
  panel.classList.toggle("error", !matches);
  panel.textContent = (matches ? "✓ IGST totals match" : "⚠ IGST totals differ")
    + " — grouped Calculated IGST: " + formatMoney(groupedTotal)
    + "; item-line Calculated IGST sum: " + formatMoney(itemTotal) + ".";
}

function renderUnitMapping() {
  const rows = formatUqcMappingRows(state.latest?.grouped || []);
  const content = '<div class="eyebrow">UQC to NIC unit-code mapping</div>'
    + '<p class="small muted">Only codes present in the NIC master list are mapped. Unknown UQCs remain empty in JSON and block upload readiness.</p>'
    + '<div class="tablewrap"><table class="data"><thead><tr><th>BOE UQC</th><th>NIC qtyUnit</th><th>Mapping status</th></tr></thead><tbody>'
    + rows.map((row) => '<tr><td>' + escapeHtml(row.uqc || "—") + '</td><td class="mono">'
      + escapeHtml(row.nicCode || "(empty)") + '</td><td>'
      + (row.known ? '<span class="status">Mapped from NIC master list</span>' : '<span class="status error">No confirmed mapping</span>')
      + "</td></tr>").join("")
    + "</tbody></table></div>";
  $("eway-unit-mapping").innerHTML = content;
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
    const matchingItems = findMatchingItems(group, state.latest.items || []);
    const rates = [...new Set(matchingItems.map((item) => toNumber(item["IGST Rate (%)"])).filter((value) => value !== null))];
    if (rates.length > 1) {
      confirmedMixedRates[index] = {
        rate: $("eway-rate-" + index)?.value.trim() || "",
        confirmed: state.ewayRateConfirmations[index] === true,
      };
    }
  });

  return buildNicBulkJson({
    response: state.latest,
    form: readForm(),
    confirmedMixedRates,
  });
}

function renderJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
}

async function copyNicJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
  if (!result.ready) {
    return;
  }
  await copyText(JSON.stringify(result.json, null, 2), $("copy-json"));
}

function downloadNicJson() {
  const result = buildCurrent();
  $("eway-json").textContent = JSON.stringify(result.json, null, 2);
  showWarnings(result.warnings, result.blockingErrors);
  if (!result.ready) {
    return;
  }

  const bytes = new Blob([JSON.stringify(result.json, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "BOE_FLOW_NIC_EWAY_BULK.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showWarnings(warnings, blockingErrors) {
  const panel = $("eway-warnings");
  const all = [...new Set(warnings)];
  if (!all.length) {
    panel.classList.add("hidden");
    panel.textContent = "";
    return;
  }

  panel.classList.remove("hidden");
  panel.innerHTML = "<strong>" + (blockingErrors.length ? "Not upload-ready — resolve these fields first" : "Review these warnings")
    + "</strong><ul>" + all.map((warning) => "<li>" + escapeHtml(warning) + "</li>").join("") + "</ul>"
    + (blockingErrors.length ? '<p class="small">Blocking fields: ' + escapeHtml(blockingErrors.join(", ")) + "</p>" : "");
  panel.classList.toggle("error", blockingErrors.length > 0);
}

function hidePreviousJson() {
  $("eway-json").textContent = "Form values changed. Build NIC JSON again to refresh the preview and warnings.";
}

function sumGroupField(groups, field) {
  const values = groups.map((group) => toNumber(group[field]));
  if (values.some((value) => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const oldText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = oldText; }, 1300);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
