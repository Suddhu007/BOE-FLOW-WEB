import {
  checkGroupedTotals,
  displayValue,
  formatMoney,
  formatQuantity,
  formatRate,
  isMissing,
  sumKnown,
  toNumber,
} from "./formatters.js";

const MAIN_COLUMNS = [
  ["Item No", "Item no."],
  ["HSN Code", "HSN code"],
  ["Description", "Description"],
  ["Quantity", "Quantity"],
  ["UQC", "UQC"],
  ["Unit Price (FC)", "Unit price (FC)"],
  ["Assessable Value (CIF INR)", "Assessable value"],
  ["BCD Rate (%)", "BCD rate"],
  ["BCD Amount", "BCD amount"],
  ["SWS Rate (%)", "SWS rate"],
  ["SWS Amount", "SWS amount"],
  ["IGST Rate (%)", "IGST rate"],
  ["IGST Amount", "IGST amount"],
  ["GST Taxable Value (for E-Way)", "GST taxable value"],
];

const NUMBER_FIELDS = new Set([
  "Quantity", "Unit Price (FC)", "Assessable Value (CIF INR)", "BCD Amount",
  "SWS Amount", "IGST Amount", "GST Taxable Value (for E-Way)",
  "Calculated IGST", "BCD Rate (%)", "SWS Rate (%)", "IGST Rate (%)",
  "Item Total Duty", "Total Duty Payable (Incl. GST)", "Other Customs Duty",
  "BCD Duty Forgone", "SWS Duty Forgone",
]);

const HEADER_FIELDS = [
  ["BOE Number", "BOE number"],
  ["BOE Date", "BOE date"],
  ["Port Code", "Port code"],
  ["Importer Name", "Importer"],
  ["Importer GSTIN", "Importer GSTIN"],
  ["Supplier Name", "Supplier"],
  ["Invoice Number", "Invoice number"],
  ["Invoice Amount", "Invoice amount"],
  ["Exchange Rate", "Exchange rate"],
  ["Mode", "Mode"],
  ["HAWB No", "HAWB"],
  ["MAWB No", "MAWB"],
];

export function setupResultsTable({ state, navigate }) {
  document.querySelectorAll("#view-boe th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (state.sortKey === key) {
        state.sortDirection *= -1;
      } else {
        state.sortKey = key;
        state.sortDirection = 1;
      }
      state.page = 1;
      drawItems(state);
    });
  });

  document.getElementById("item-search").addEventListener("input", () => {
    state.page = 1;
    drawItems(state);
  });
  document.getElementById("page-size").addEventListener("change", (event) => {
    state.pageSize = Number(event.target.value) || 25;
    state.page = 1;
    drawItems(state);
  });
  document.getElementById("page-prev").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    drawItems(state);
  });
  document.getElementById("page-next").addEventListener("click", () => {
    state.page += 1;
    drawItems(state);
  });
  document.getElementById("download-excel").addEventListener("click", () => downloadExcel(state.latest));
  document.getElementById("open-eway").addEventListener("click", () => navigate("eway"));
}

export function renderResultWorkspace(state) {
  const response = state.latest;
  if (!response) return;
  const header = response.header || {};
  const items = response.items || [];

  document.getElementById("boe-title").textContent = displayValue(header["BOE Number"]);
  document.getElementById("boe-subtitle").textContent =
    (response.filename || "BOE document") + " · " + items.length + " item lines";

  document.getElementById("header-kv").innerHTML = HEADER_FIELDS.map(([key, label]) =>
    '<div class="kv"><div class="k">' + escapeHtml(label) + '</div><div class="v">'
      + escapeHtml(displayValue(header[key])) + "</div></div>"
  ).join("");

  const assessableValues = items.map((item) => toNumber(item["Assessable Value (CIF INR)"]));
  const assessableIsComplete = assessableValues.length > 0
    && assessableValues.every((value) => value !== null);
  const assessableTotal = assessableIsComplete
    ? assessableValues.reduce((sum, value) => sum + value, 0)
    : null;

  const metrics = [
    ["Item lines", isMissing(header["Total Items Count"]) ? items.length : header["Total Items Count"], "From header / items"],
    ["Assessable value", assessableTotal === null ? "—" : formatMoney(assessableTotal), "Sum of item lines · INR"],
    ["BCD total", formatMoney(header["BCD Total"]), "From BOE header · INR"],
    ["SWS total", formatMoney(header["SWS Total"]), "From BOE header · INR"],
    ["IGST total", formatMoney(header["IGST Total"]), "From BOE header · INR"],
    ["Total duty", formatMoney(header["Total Duty"]), "From BOE header · INR"],
  ];
  document.getElementById("metrics").innerHTML = metrics.map(([label, value, caption]) =>
    '<div class="metric"><div class="label">' + escapeHtml(label) + '</div><strong>'
      + escapeHtml(value) + '</strong><small>' + escapeHtml(caption) + "</small></div>"
  ).join("");

  document.getElementById("row-count").textContent = items.length + " lines";
  document.getElementById("item-search").value = "";
  state.items = items;
  state.filteredItems = [];
  state.page = 1;
  drawItems(state);
  drawGroupedLines(state);
  drawDutyBreakdown(state);
  drawMoreDetails(state);
}

function drawItems(state) {
  const query = document.getElementById("item-search").value.trim().toLowerCase();
  let rows = state.items.map((item, index) => ({ item, index })).filter(({ item }) =>
    !query || Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(query))
  );

  if (state.sortKey) {
    rows.sort((left, right) => {
      const a = left.item[state.sortKey];
      const b = right.item[state.sortKey];
      const aNumber = toNumber(a);
      const bNumber = toNumber(b);
      let comparison;
      if (aNumber !== null && bNumber !== null) comparison = aNumber - bNumber;
      else comparison = String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
      return comparison * state.sortDirection;
    });
  }

  state.filteredItems = rows;
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const visibleRows = rows.slice(start, start + state.pageSize);
  const body = document.getElementById("items-body");

  body.innerHTML = visibleRows.map(({ item, index }) =>
    '<tr tabindex="0" data-detail="' + index + '" aria-label="Open details for item '
      + escapeHtml(item["Item No"] ?? index + 1) + '">'
      + MAIN_COLUMNS.map(([key]) => '<td class="' + (NUMBER_FIELDS.has(key) ? "num " : "")
        + (key === "Description" ? "desc" : "") + '" title="' + escapeHtml(displayValue(item[key], "—")) + '">'
        + escapeHtml(formatItemField(key, item[key])) + "</td>").join("")
      + "</tr>"
  ).join("") || '<tr><td colspan="14" class="empty">No matching item lines.</td></tr>';

  document.getElementById("filtered-count").textContent = rows.length + " matching";
  document.getElementById("page-info").textContent = rows.length
    ? "Page " + state.page + " of " + pages + " · rows " + (start + 1) + "–" + Math.min(start + state.pageSize, rows.length)
    : "0 items";
  document.getElementById("page-prev").disabled = state.page <= 1;
  document.getElementById("page-next").disabled = state.page >= pages;

  body.querySelectorAll("tr[data-detail]").forEach((row) => {
    const open = () => openItemDetails(state.items[Number(row.dataset.detail)]);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function formatItemField(key, value) {
  if (isMissing(value)) return "—";
  if (NUMBER_FIELDS.has(key)) return key.includes("Rate") ? formatRate(value) : formatMoney(value);
  return String(value);
}

function openItemDetails(item) {
  if (!item) return;
  const detailFields = [
    ["Country of Origin Code", "Country of origin"],
    ["BCD Duty Forgone", "BCD duty forgone"],
    ["SWS Duty Forgone", "SWS duty forgone"],
    ["Other Customs Duty", "Other customs duty"],
    ["Item Total Duty", "Item total duty"],
    ["Total Duty Payable (Incl. GST)", "Total duty payable (incl. GST)"],
    ["Calculated IGST", "Calculated IGST"],
  ];
  const fields = [
    ["Item No", "Item number"],
    ["HSN Code", "HSN code"],
    ["Description", "Description"],
    ["Quantity", "Quantity"],
    ["UQC", "UQC"],
    ["Assessable Value (CIF INR)", "Assessable value (INR)"],
    ...detailFields,
  ];

  document.getElementById("drawer-host").innerHTML =
    '<div class="drawerback" id="drawer-back"><aside class="drawer" role="dialog" aria-modal="true" aria-label="BOE item details">'
    + '<div class="drawerhead"><div><div class="eyebrow">Item detail</div><h2>Item '
    + escapeHtml(displayValue(item["Item No"])) + '</h2></div><button class="iconbtn" id="close-drawer" aria-label="Close item details">✕</button></div>'
    + '<div class="kvgrid">' + fields.map(([key, label]) =>
      '<div class="kv"><div class="k">' + escapeHtml(label) + '</div><div class="v">'
        + escapeHtml(formatItemField(key, item[key])) + "</div></div>"
    ).join("") + '</div><p class="footnote">All fields above come from the backend response. No duty calculation is performed in this drawer.</p></aside></div>';

  document.getElementById("close-drawer").addEventListener("click", closeDrawer);
  document.getElementById("drawer-back").addEventListener("click", (event) => {
    if (event.target.id === "drawer-back") closeDrawer();
  });
  document.getElementById("close-drawer").focus();
}

function closeDrawer() {
  document.getElementById("drawer-host").innerHTML = "";
}

function drawGroupedLines(state) {
  const response = state.latest;
  const groups = response.grouped || [];
  const fields = [
    "Quantity",
    "Assessable Value (CIF INR)",
    "GST Taxable Value (for E-Way)",
    "Calculated IGST",
  ];

  document.getElementById("groups-body").innerHTML = groups.map((group) =>
    "<tr>"
    + ["HSN Code", "UQC", ...fields].map((key, index) => {
      const value = group[key];
      const formatted = index < 2 ? displayValue(value, "—")
        : key === "Quantity" ? formatQuantity(value) : formatMoney(value);
      return '<td class="' + (index >= 2 ? "num" : "") + '">' + escapeHtml(formatted) + "</td>";
    }).join("")
    + "</tr>"
  ).join("") || '<tr><td colspan="6" class="empty">No grouped E-Way lines in API response.</td></tr>';

  const totals = fields.map((field) => {
    const total = sumKnown(groups.map((group) => group[field]));
    return field === "Quantity" ? formatQuantity(total) : formatMoney(total);
  });
  document.getElementById("groups-foot").innerHTML = groups.length
    ? '<tr><th colspan="2">Backend grouped totals</th>' + totals.map((value) => '<th class="num">' + escapeHtml(value) + "</th>").join("") + "</tr>"
    : "";

  const checks = checkGroupedTotals(response.items || [], groups, fields);
  const matching = checks.every((check) => check.matches);
  document.getElementById("groups-check").innerHTML =
    '<span class="status ' + (matching ? "" : "error") + '">'
    + (matching ? "✓ Grouped totals match item lines" : "! Grouped totals differ or item totals are incomplete")
    + '</span><div class="small muted" style="margin-top:6px">'
    + checks.map((check) => escapeHtml(check.field + ": " + formatMoney(check.itemTotal) + " vs " + formatMoney(check.groupedTotal))).join(" · ")
    + "</div>";
}

function drawDutyBreakdown(state) {
  const header = state.latest.header || {};
  const definitions = [
    ["BCD", "BCD Total", "BCD Amount"],
    ["SWS", "SWS Total", "SWS Amount"],
    ["IGST", "IGST Total", "Calculated IGST"],
    ["Other Customs Duty", null, "Other Customs Duty"],
    ["Total Duty", "Total Duty", "Item Total Duty"],
  ];

  document.getElementById("duty-body").innerHTML = definitions.map(([label, headerKey, itemKey]) => {
    const headerValue = headerKey ? header[headerKey] : null;
    const itemValues = state.items.map((item) => toNumber(item[itemKey]));
    const itemTotal = itemValues.some((value) => value !== null)
      ? itemValues.reduce((sum, value) => sum + (value ?? 0), 0)
      : null;
    const hasHeader = !isMissing(headerValue);
    const shownAmount = hasHeader ? formatMoney(headerValue) : formatMoney(itemTotal);
    const source = hasHeader ? "BOE header" : itemTotal !== null ? "Sum of item lines" : "Not in BOE data";
    return "<tr><td>" + escapeHtml(label) + '</td><td class="num">' + escapeHtml(shownAmount)
      + "</td><td>" + escapeHtml(source) + "</td></tr>";
  }).join("");
}

function drawMoreDetails(state) {
  const header = state.latest.header || {};
  const sections = [
    ["Importer and supplier", ["Importer Name", "Importer GSTIN", "Supplier Name", "Supplier Details", "Supplier Address"]],
    ["Invoice and exchange rate", ["Invoice Number", "Invoice Date", "Invoice Amount", "Exchange Rate"]],
    ["Shipment and container", ["Mode", "MAWB No", "HAWB No", "Container No", "LCL / FCL", "Gross Weight (KGS)"]],
    ["Customs broker details", ["CB Name", "CB Code"]],
  ];

  const detailsHtml = sections.map(([title, keys]) =>
    '<details class="details"><summary>' + escapeHtml(title) + '</summary><div class="inside"><div class="kvgrid">'
      + keys.map((key) => '<div class="kv"><div class="k">' + escapeHtml(key) + '</div><div class="v">'
        + escapeHtml(displayValue(header[key])) + "</div></div>").join("")
      + "</div></div></details>"
  ).join("");

  const rawResponse = JSON.stringify({
    filename: state.latest.filename,
    header: state.latest.header,
    items: state.latest.items,
    grouped: state.latest.grouped,
  }, null, 2);

  document.getElementById("more-details").innerHTML = detailsHtml
    + '<details class="details"><summary>All raw fields · API response</summary><div class="inside">'
    + '<button id="copy-raw" class="btn">Copy raw JSON</button><pre>' + escapeHtml(rawResponse) + "</pre></div></details>";
  document.getElementById("copy-raw").addEventListener("click", () => copyText(rawResponse, document.getElementById("copy-raw")));
}

function downloadExcel(response) {
  if (!response?.excel_base64) return;
  try {
    const bytes = Uint8Array.from(atob(response.excel_base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (response.filename || "BOE").replace(/\.pdf$/i, "") + "_Export.xlsx";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.alert("Could not create Excel download from the API response.");
  }
}

function copyText(text, button) {
  navigator.clipboard?.writeText(text).then(() => {
    if (!button) return;
    const oldText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = oldText; }, 1300);
  }).catch(() => fallbackCopy(text, button));
}

function fallbackCopy(text, button) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    if (button) {
      const oldText = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = oldText; }, 1300);
    }
  } finally {
    textarea.remove();
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
