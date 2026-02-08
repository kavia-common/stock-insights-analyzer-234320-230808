/**
 * Strict output schema utilities for Stock Check (43-Factor Model).
 *
 * UI + client MUST treat rows as positional arrays with 12 immutable columns.
 * Any attempt to reorder or infer keys is a system failure per spec.
 *
 * Additional compliance rules implemented here:
 * - INTC Enforcement: INTC must always be present with Rank == 11.
 * - Overlay Isolation: TRADE/NO_TRADE and Hold/Exit overlays must not alter rankings or predictions.
 * - Metrics Compliance: INTC must be excluded from Top-10 metrics computations.
 */

export const CANONICAL_COLUMNS = [
  "Rank",
  "Ticker",
  "Current EOD Price",
  "Predicted Price",
  "Predicted % Growth",
  "3-Month",
  "6-Month",
  "12-Month",
  "Signal",
  "Hold / Exit Overlay",
  "Actual EOD (Prediction Date)",
  "% Growth vs Actual"
];

/**
 * Default header values per strict schema.
 * We default trade_status to NO_TRADE and sector_warning to false.
 */
export const DEFAULT_HEADER = Object.freeze({
  trade_status: "NO_TRADE",
  avg_predicted_growth: null,
  dispersion: null,
  sector_warning: false
});

const RANK_COL = 0;
const TICKER_COL = 1;
const HOLD_EXIT_OVERLAY_COL = 9;

/**
 * Coerce/normalize unknown header payload to strict schema.
 * - trade_status ∈ {"TRADE","NO_TRADE"} else "NO_TRADE"
 * - avg_predicted_growth: number|null else null
 * - dispersion: number|null else null
 * - sector_warning: boolean else false
 *
 * @param {any} headerIn
 * @returns {{trade_status:"TRADE"|"NO_TRADE", avg_predicted_growth:number|null, dispersion:number|null, sector_warning:boolean}}
 */
function normalizeHeader(headerIn) {
  const h = headerIn && typeof headerIn === "object" ? headerIn : {};

  const trade_status =
    h.trade_status === "TRADE" || h.trade_status === "NO_TRADE"
      ? h.trade_status
      : DEFAULT_HEADER.trade_status;

  const avg_predicted_growth = typeof h.avg_predicted_growth === "number" ? h.avg_predicted_growth : null;

  const dispersion = typeof h.dispersion === "number" ? h.dispersion : null;

  const sector_warning = typeof h.sector_warning === "boolean" ? h.sector_warning : DEFAULT_HEADER.sector_warning;

  return { trade_status, avg_predicted_growth, dispersion, sector_warning };
}

/**
 * Normalize a single row into an array of exactly 12 cells, preserving nulls.
 * If row isn't an array, treat as empty then pad with nulls.
 * If row is too long, truncate to 12 (positional order lock).
 *
 * @param {any} row
 * @returns {any[]}
 */
function normalizeRow(row) {
  const out = Array.isArray(row) ? row.slice(0, CANONICAL_COLUMNS.length) : [];
  while (out.length < CANONICAL_COLUMNS.length) out.push(null);
  return out;
}

/**
 * Create a minimal INTC row consistent with strict schema.
 * We do NOT fabricate any prices/predictions; blanks are preserved as null.
 *
 * @returns {any[]}
 */
function createIntcRow() {
  const row = Array(CANONICAL_COLUMNS.length).fill(null);
  row[RANK_COL] = 11;
  row[TICKER_COL] = "INTC";
  // Overlay column remains null unless backend explicitly provides it.
  row[HOLD_EXIT_OVERLAY_COL] = null;
  return row;
}

/**
 * Ensure INTC is present and rank-locked to 11.
 *
 * Important:
 * - We do NOT reorder the existing rows, because UI must render in array order.
 * - We do NOT mutate other tickers' Rank/Predicted fields (overlay isolation).
 * - We only (a) enforce INTC rank value if present, or (b) append INTC if missing.
 *
 * @param {any[][]} rows
 * @returns {any[][]}
 */
function enforceIntcRank11(rows) {
  const safeRows = Array.isArray(rows) ? rows.slice() : [];

  let intcIndex = -1;
  for (let i = 0; i < safeRows.length; i += 1) {
    const ticker = safeRows[i]?.[TICKER_COL];
    if (typeof ticker === "string" && ticker.trim().toUpperCase() === "INTC") {
      intcIndex = i;
      break;
    }
  }

  if (intcIndex === -1) {
    // Missing INTC: append a canonical empty row with rank fixed to 11.
    safeRows.push(createIntcRow());
    return safeRows;
  }

  // Present INTC: force rank to 11, leave all other columns as-is to preserve nulls.
  const fixed = safeRows[intcIndex].slice();
  fixed[RANK_COL] = 11;
  safeRows[intcIndex] = fixed;
  return safeRows;
}

/**
 * Returns true if a row is the INTC row.
 * @param {any[]} row
 * @returns {boolean}
 */
function isIntcRow(row) {
  const t = row?.[TICKER_COL];
  return typeof t === "string" && t.trim().toUpperCase() === "INTC";
}

/**
 * PUBLIC_INTERFACE
 */
export function normalizeRunStockCheckResponse(raw) {
  /**
   * Convert any raw response into the strict schema:
   * {
   *   header: { trade_status, avg_predicted_growth, dispersion, sector_warning },
   *   rows: [ [..12 positional cells..], ...]
   * }
   *
   * Compliance behaviors:
   * - Column Order Lock: always 12 cells per row, in canonical order.
   * - Null Preservation: never compute/fill values that are null/missing.
   * - INTC Enforcement: ensure INTC exists with Rank == 11.
   * - Overlay Isolation: normalization must not alter ranking/prediction fields based on overlay/header.
   *
   * @param {any} raw
   * @returns {{header: {trade_status:"TRADE"|"NO_TRADE", avg_predicted_growth:number|null, dispersion:number|null, sector_warning:boolean}, rows: any[][]}}
   */
  const obj = raw && typeof raw === "object" ? raw : {};
  const header = normalizeHeader(obj.header);

  const normalizedRows = Array.isArray(obj.rows) ? obj.rows.map(normalizeRow) : [];
  const rows = enforceIntcRank11(normalizedRows);

  return { header, rows };
}

/**
 * PUBLIC_INTERFACE
 */
export function getCanonicalColumns() {
  /** Returns the canonical column labels array (immutable order). */
  return CANONICAL_COLUMNS;
}

/**
 * PUBLIC_INTERFACE
 */
export function getTop10RowsExcludingIntc(rows) {
  /**
   * Return the first 10 rows in *array order*, excluding INTC.
   * This is used for UI metrics that must be "Top-10 excluding INTC" per spec.
   *
   * Important:
   * - We do NOT sort or reorder; we respect the backend-provided order.
   * - We exclude INTC regardless of where it appears (it is rank-locked to 11 but may appear anywhere).
   *
   * @param {any[][]} rows
   * @returns {any[][]}
   */
  const safe = Array.isArray(rows) ? rows : [];
  const out = [];
  for (let i = 0; i < safe.length && out.length < 10; i += 1) {
    const r = safe[i];
    if (Array.isArray(r) && !isIntcRow(r)) out.push(r);
  }
  return out;
}

/**
 * PUBLIC_INTERFACE
 */
export function getOverlayIsolationFingerprint(result) {
  /**
   * Build a deterministic fingerprint of ranking+prediction fields ONLY, ignoring overlays.
   *
   * Why:
   * - Used by UI diagnostics / metrics to guarantee overlays do not influence the
   *   model's ranking/prediction surface.
   * - Excludes: header.trade_status and row[9] Hold/Exit overlay.
   *
   * Included from each row:
   * - columns 0..8 (Rank..Signal) only.
   *
   * @param {{header:any, rows:any[][]}|null} result
   * @returns {string|null}
   */
  if (!result || typeof result !== "object") return null;
  const rows = Array.isArray(result.rows) ? result.rows : [];

  const surface = rows.map((r) => {
    const row = Array.isArray(r) ? r : [];
    const core = [];
    for (let idx = 0; idx <= 8; idx += 1) core.push(row[idx] ?? null);
    return core;
  });

  return JSON.stringify(surface);
}
