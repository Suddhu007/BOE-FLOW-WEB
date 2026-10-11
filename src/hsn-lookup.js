import { lookupHsn } from "./api.js";
import { displayValue } from "./formatters.js";

export function setupHsnLookup() {
  const codeInput = document.getElementById("hsn-code");
  const countryInput = document.getElementById("hsn-country");
  const resultPanel = document.getElementById("hsn-result");
  const resultBody = document.getElementById("hsn-result-body");
  const searchButton = document.getElementById("hsn-search");

  async function search() {
    const code = codeInput.value.trim();
    const country = countryInput.value.trim();

    if (!/^\d{4,8}$/.test(code)) {
      resultPanel.classList.remove("hidden");
      resultBody.innerHTML = '<p class="notice error">Enter a code containing 4 to 8 digits.</p>';
      return;
    }

    resultPanel.classList.remove("hidden");
    resultBody.innerHTML = '<span class="spinner" aria-hidden="true"></span> Looking up tariff code…';

    try {
      const result = await lookupHsn(code, country);
      resultBody.innerHTML = '<div class="eyebrow">Live tariff result</div>'
        + '<h2 style="margin:8px 0">' + escapeHtml(displayValue(result.hsn_code)) + "</h2>"
        + "<p>" + escapeHtml(displayValue(result.description)) + "</p>";
    } catch (error) {
      resultBody.innerHTML = '<div class="notice error">' + escapeHtml(error.message) + "</div>";
    }
  }

  searchButton.addEventListener("click", search);
  codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") search();
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
