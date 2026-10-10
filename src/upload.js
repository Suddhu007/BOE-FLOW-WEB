import { uploadBoe } from "./api.js";

export function setupUpload({ state, onProcessed }) {
  const fileInput = document.getElementById("boe-file");
  const browseButton = document.getElementById("browse");
  const processAnotherButton = document.getElementById("process-another");
  const dropZone = document.getElementById("drop-zone");
  const uploadTitle = document.getElementById("upload-title");
  const uploadSubtitle = document.getElementById("upload-sub");
  const uploadStatus = document.getElementById("upload-status");
  const uploadError = document.getElementById("upload-error");

  function showStatus(label, kind = "") {
    uploadStatus.textContent = label;
    uploadStatus.className = "status" + (kind ? " " + kind : "");
  }

  async function processFile(file) {
    if (!file) return;
    uploadError.classList.add("hidden");

    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      showStatus("Invalid file", "error");
      uploadTitle.textContent = "Please choose a PDF file";
      uploadSubtitle.textContent = "This upload accepts PDF documents only.";
      uploadError.textContent = "The selected file is not a PDF.";
      uploadError.classList.remove("hidden");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      showStatus("File too large", "error");
      uploadTitle.textContent = "PDF exceeds the upload limit";
      uploadSubtitle.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(2) + " MB";
      uploadError.textContent = "Choose a PDF no larger than 25 MB.";
      uploadError.classList.remove("hidden");
      return;
    }

    showStatus("Processing");
    uploadTitle.innerHTML = '<span class="spinner" aria-hidden="true"></span> Uploading and processing';
    uploadSubtitle.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(2) + " MB. Please keep this page open.";
    browseButton.disabled = true;
    processAnotherButton.classList.add("hidden");

    try {
      const response = await uploadBoe(file);
      state.latest = response;
      state.items = response.items;
      state.page = 1;
      state.ewayRates = {};
      state.ewayRateConfirmations = {};
      onProcessed(response);
      showStatus("Processed");
      uploadTitle.textContent = "BOE processed successfully";
      uploadSubtitle.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(2) + " MB · Result stored in this browser session.";
      document.getElementById("result-empty").classList.add("hidden");
      document.getElementById("result-content").classList.remove("hidden");
      processAnotherButton.classList.remove("hidden");
      window.location.hash = "/boe";
      document.getElementById("result-content").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showStatus("Needs attention", "error");
      uploadTitle.textContent = "Could not process this BOE";
      uploadSubtitle.textContent = file.name;
      uploadError.textContent = error.message || "Unexpected error while processing this PDF.";
      uploadError.classList.remove("hidden");
    } finally {
      browseButton.disabled = false;
      fileInput.value = "";
    }
  }

  browseButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (event) => processFile(event.target.files?.[0]));
  processAnotherButton.addEventListener("click", () => {
    uploadTitle.textContent = "Choose another BOE PDF";
    uploadSubtitle.textContent = "Select another PDF to replace the current result.";
    fileInput.click();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag");
    });
  });
  dropZone.addEventListener("drop", (event) => processFile(event.dataTransfer?.files?.[0]));
}
