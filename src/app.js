import { checkApiHealth } from "./api.js";
import { state } from "./state.js";
import { setupUpload } from "./upload.js";
import { renderResultWorkspace, setupResultsTable } from "./results-table.js";
import { setupEway, updateEwayForResponse, renderEway } from "./eway.js";
import { setupDutyCalculator } from "./duty-calculator.js";
import { setupHsnLookup } from "./hsn-lookup.js";

function navigate(tab) {
  window.location.hash = "/" + tab;
}

function renderTabs() {
  const current = getCurrentTab();
  document.querySelectorAll(".tab").forEach((tabButton, index, tabs) => {
    const active = tabButton.dataset.tab === current;
    tabButton.setAttribute("aria-selected", String(active));
    tabButton.tabIndex = active ? 0 : -1;
    tabButton.setAttribute("aria-disabled", String(tabButton.dataset.tab === "eway" && !state.latest));

    tabButton.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      tabs[nextIndex].focus();
      navigate(tabs[nextIndex].dataset.tab);
    };
  });

  ["boe", "eway", "duty", "hsn", "help"].forEach((name) => {
    document.getElementById("view-" + name).classList.toggle("hidden", name !== current);
  });

  if (current === "eway") renderEway();
}

function getCurrentTab() {
  const match = window.location.hash.match(/^#\/(boe|eway|duty|hsn|help)$/);
  return match ? match[1] : "boe";
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const oldText = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = oldText; }, 1300);
    }
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      if (button) {
        const oldText = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = oldText; }, 1300);
      }
    } finally {
      textarea.remove();
    }
  }
}

function setupThemeToggle() {
  const button = document.getElementById("theme-toggle");
  button.addEventListener("click", () => {
    const dark = document.body.classList.toggle("dark");
    button.textContent = dark ? "☼" : "◐";
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  });
}

function setupNavigation() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.tab));
  });
  window.addEventListener("hashchange", renderTabs);
}

async function showApiHealth() {
  const indicator = document.getElementById("api-health");
  try {
    if (await checkApiHealth()) {
      indicator.classList.add("hidden");
    } else {
      indicator.textContent = "The BOE API is not responding. It may be waking up; retry in a moment.";
      indicator.classList.remove("hidden");
    }
  } catch {
    indicator.textContent = "Could not contact the BOE API. Check the connection and retry when the service is available.";
    indicator.classList.remove("hidden");
  }
}

function onProcessed(response) {
  renderResultWorkspace(state);
  updateEwayForResponse(response);
  renderTabs();
}

function startApplication() {
  setupNavigation();
  setupThemeToggle();
  setupResultsTable({ state, navigate });
  setupUpload({ state, onProcessed });
  setupEway();
  setupDutyCalculator(copyText);
  setupHsnLookup();
  renderTabs();
  showApiHealth();
}

startApplication();
