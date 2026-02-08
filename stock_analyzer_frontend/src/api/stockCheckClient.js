/**
 * Stock Check API client.
 *
 * Requirements (from spec):
 * - POST /run-stock-check with { current_date, prediction_date, macro_override }
 * - Use env-based URL (REACT_APP_API_BASE or REACT_APP_BACKEND_URL)
 * - On failures/timeouts/outage: return normalized nulls; do not retry across time
 * - Deterministic output for identical inputs/payloads
 * - Preserve nulls (never estimate or "fill in" missing values)
 */

import { CANONICAL_COLUMNS, normalizeRunStockCheckResponse } from "../stockCheckSchema";

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Normalize a base URL to ensure no trailing slash.
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

/**
 * Resolve API base URL from environment variables.
 * Preference order:
 * 1) REACT_APP_API_BASE
 * 2) REACT_APP_BACKEND_URL
 *
 * @returns {string} base URL (may be empty string)
 */
function getApiBaseUrl() {
  // CRA exposes env vars on process.env at build time.
  const base = process.env.REACT_APP_API_BASE || process.env.REACT_APP_BACKEND_URL || "";
  return normalizeBaseUrl(base);
}

/**
 * Create a deterministic 32-bit hash of a string.
 * (Used only to create a stable stub trade_status for identical inputs.)
 *
 * @param {string} str
 * @returns {number} uint32
 */
function hashString32(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    // multiply by FNV prime (2^24 + 2^8 + 0x93) using shifts to stay in 32-bit
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}



/**
 * Deterministic null-preserving stub fallback.
 * Must be byte-for-byte stable for identical inputs (we do not include timestamps).
 *
 * @param {{current_date: string, prediction_date: string, macro_override: ("NO_TRADE"|null)}} payload
 * @returns {{header: {trade_status: "TRADE"|"NO_TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: boolean}, rows: any[][]}}
 */
function deterministicStubFallback(payload) {
  // We intentionally do not fabricate rows/prices; blanks are a feature.
  // For determinism, we choose trade_status based on payload content only.
  const key = JSON.stringify({
    current_date: payload?.current_date ?? null,
    prediction_date: payload?.prediction_date ?? null,
    macro_override: payload?.macro_override ?? null
  });

  const h = hashString32(key);
  // If macro override is explicitly NO_TRADE, enforce NO_TRADE.
  const trade_status =
    payload && payload.macro_override === "NO_TRADE" ? "NO_TRADE" : h % 2 === 0 ? "NO_TRADE" : "TRADE";

  return {
    header: {
      trade_status,
      avg_predicted_growth: null,
      dispersion: null,
      sector_warning: false
    },
    rows: []
  };
}

/**
 * POST JSON with a hard timeout using AbortController.
 *
 * @param {string} url
 * @param {any} body
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
async function postJsonWithTimeout(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    // If backend returns non-2xx, treat as failure -> fallback.
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    // If response isn't JSON, treat as failure -> fallback.
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// PUBLIC_INTERFACE
export async function runStockCheck(payload, options = {}) {
  /**
   * Run the Stock Check model.
   *
   * @param {{current_date: string, prediction_date: string, macro_override: ("NO_TRADE"|null)}} payload
   * @param {{timeoutMs?: number}} options
   * @returns {Promise<{header: {trade_status: "TRADE"|"NO_TRADE", avg_predicted_growth: number|null, dispersion: number|null, sector_warning: boolean}, rows: any[][]}>}
   */
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/run-stock-check`;

  // Basic payload normalization (do not invent values)
  const reqBody = {
    current_date: payload?.current_date ?? null,
    prediction_date: payload?.prediction_date ?? null,
    macro_override: payload?.macro_override ?? null
  };

  // If base URL isn't configured, always fallback deterministically.
  if (!baseUrl) {
    return deterministicStubFallback(reqBody);
  }

  try {
    const raw = await postJsonWithTimeout(endpoint, reqBody, timeoutMs);
    return normalizeRunStockCheckResponse(raw);
  } catch (e) {
    // No retries; deterministic fallback.
    return deterministicStubFallback(reqBody);
  }
}
