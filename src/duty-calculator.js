import { formatMoney } from "./formatters.js";

export function calculateDuties() {
  const assessableValue = Number(document.getElementById("calcAssessable").value) || 0;
  const bcdRate = Number(document.getElementById("calcBcdRate").value) || 0;
  const igstRate = Number(document.getElementById("calcIgstRate").value) || 0;

  // Keep the existing estimate formula unchanged.
  const bcd = assessableValue * bcdRate / 100;
  const sws = bcd * 0.1;
  const igstBase = assessableValue + bcd + sws;
  const igst = igstBase * igstRate / 100;
  const total = bcd + sws + igst;

  document.getElementById("resBcd").textContent = formatMoney(bcd);
  document.getElementById("resSws").textContent = formatMoney(sws);
  document.getElementById("resIgstBase").textContent = formatMoney(igstBase);
  document.getElementById("resIgstLabel").textContent = "IGST (" + igstRate + "%)";
  document.getElementById("resIgst").textContent = formatMoney(igst);
  document.getElementById("resTotal").textContent = formatMoney(total);
}

export function setupDutyCalculator(copyText) {
  ["calcAssessable", "calcBcdRate", "calcIgstRate"].forEach((id) => {
    document.getElementById(id).addEventListener("input", calculateDuties);
    document.getElementById(id).addEventListener("change", calculateDuties);
  });

  document.getElementById("copy-duty").addEventListener("click", () => {
    const text = [
      "BOE FLOW Duty Estimate",
      "Assessable value: " + document.getElementById("calcAssessable").value,
      "BCD rate: " + document.getElementById("calcBcdRate").value + "%",
      "IGST rate: " + document.getElementById("calcIgstRate").value + "%",
      "BCD: " + document.getElementById("resBcd").textContent,
      "SWS: " + document.getElementById("resSws").textContent,
      "IGST base: " + document.getElementById("resIgstBase").textContent,
      "IGST: " + document.getElementById("resIgst").textContent,
      "Estimated total duty: " + document.getElementById("resTotal").textContent,
    ].join("\n");
    copyText(text, document.getElementById("copy-duty"));
  });

  calculateDuties();
}
