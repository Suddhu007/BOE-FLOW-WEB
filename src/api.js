const configuredBase = (document.querySelector('meta[name="boe-flow-api-url"]')?.content || "").trim();

export const API_BASE = configuredBase && !configuredBase.startsWith("%")
  ? configuredBase.replace(/\/$/, "")
  : "https://boe-flow-api.onrender.com";

async function parseResponse(response) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error("The API returned an empty response (HTTP " + response.status + "). It may have timed out or restarted; retry after the server wakes up.");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The API returned a non-JSON response (HTTP " + response.status + "). Retry and check the Render logs if it continues.");
  }

  if (!response.ok) {
    const message = response.status === 429
      ? "Too many requests. Please wait a minute before trying again."
      : response.status === 413
        ? "This PDF is too large. The upload limit is 25 MB."
        : response.status === 422
          ? (data.detail || "The PDF was not recognized as a valid BOE or could not be parsed.")
          : response.status === 400
            ? (data.detail || "The server rejected this upload. Confirm it is a non-empty PDF.")
            : (data.detail || "Request failed (HTTP " + response.status + ").");
    throw new Error(message);
  }

  return data;
}

export async function uploadBoe(file, { timeoutMs = 180000 } = {}) {
  const form = new FormData();
  form.append("file", file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_BASE + "/api/boe/process", {
      method: "POST",
      body: form,
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await parseResponse(response);
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.grouped) || !data.header) {
      throw new Error("The API response is missing expected BOE fields. No result was displayed.");
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request took too long. The Render server may be waking up; wait briefly and retry.");
    }
    if (error instanceof TypeError) {
      throw new Error("Could not connect to the BOE API. Check internet and API/CORS configuration, then retry.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupHsn(code, country = "") {
  const query = country ? "?country=" + encodeURIComponent(country) : "";
  const response = await fetch(API_BASE + "/api/hsn/" + encodeURIComponent(code) + query, {
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function checkApiHealth() {
  const response = await fetch(API_BASE + "/api/health", { cache: "no-store" });
  return response.ok;
}
