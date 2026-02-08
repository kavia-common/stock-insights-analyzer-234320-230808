/**
 * Strict output schema utilities for Stock Check (43-Factor Model).
 *
 * UI + client MUST treat rows as positional arrays with 12 immutable columns.
 * Any attempt to reorder or infer keys is a system failure per spec.
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
   * This function is the single source of truth for strict rendering.
   *
   * @param {any} raw
   * @returns {{header: {trade_status:"TRADE"|"NO_TRADE", avg_predicted_growth:number|null, dispersion:number|null, sector_warning:boolean}, rows: any[][]}}
   */
  const obj = raw && typeof raw === "object" ? raw : {};
  const header = normalizeHeader(obj.header);

  const rows = Array.isArray(obj.rows) ? obj.rows.map(normalizeRow) : [];

  return { header, rows };
}

/**
 * PUBLIC_INTERFACE
 */
export function getCanonicalColumns() {
  /** Returns the canonical column labels array (immutable order). */
  return CANONICAL_COLUMNS;
}
