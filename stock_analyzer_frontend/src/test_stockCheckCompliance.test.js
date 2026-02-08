import { runStockCheck } from "./api/stockCheckClient";
import {
  CANONICAL_COLUMNS,
  getOverlayIsolationFingerprint,
  getTop10RowsExcludingIntc,
  normalizeRunStockCheckResponse
} from "./stockCheckSchema";

function getTickerToRowMap(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const t = r?.[1];
    if (typeof t === "string") map.set(t.trim().toUpperCase(), r);
  });
  return map;
}

/**
 * 3.1 No Future Actuals
 * We don't depend on real clock here; we simulate the scenario by providing
 * a row where "Actual EOD (Prediction Date)" and "% Growth vs Actual" are null.
 */
function buildFuturePredictionRawResponse() {
  return {
    header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
    rows: [
      // canonical 12 columns
      [1, "AAPL", "$190.25", "$191.40", "0.61%", null, null, null, "🟢 Strong", "HOLD", null, null]
    ]
  };
}

describe("Stock Check forward-mode compliance suite (authoritative spec §3.1–§3.6)", () => {
  beforeEach(() => {
    // Some environments set REACT_APP_API_BASE/REACT_APP_BACKEND_URL to a real endpoint.
    // The spec requires deterministic stub fallback when unreachable, but jsdom fetch failures
    // can be noisy. For compliance tests we force the stub path by clearing base URLs.
    process.env.REACT_APP_API_BASE = "";
    process.env.REACT_APP_BACKEND_URL = "";
  });

  test("3.5 Column Order Lock: every normalized row is exactly 12 cells and index mapping is stable", () => {
    const raw = {
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        // too short -> must be padded with nulls
        [1, "AAPL", "$190.25"],
        // too long -> must be truncated to 12
        [
          2,
          "MSFT",
          "$410.00",
          "$412.00",
          "0.49%",
          "$420.00 (2.4%)",
          "$430.00 (4.9%)",
          "$450.00 (9.8%)",
          "🟡",
          "HOLD",
          null,
          null,
          "EXTRA_CELL_SHOULD_BE_DROPPED"
        ]
      ]
    };

    const out = normalizeRunStockCheckResponse(raw);

    // Every row must be exactly 12 cells.
    out.rows.forEach((row) => {
      expect(Array.isArray(row)).toBe(true);
      expect(row).toHaveLength(CANONICAL_COLUMNS.length);
    });

    const byTicker = getTickerToRowMap(out.rows);
    const aapl = byTicker.get("AAPL");
    expect(aapl).toHaveLength(12);

    // Spot-check canonical positions so index-to-column mapping stays unchanged.
    // Index 0: Rank, 1: Ticker, 2: Current EOD Price, 10: Actual EOD, 11: % Growth vs Actual
    expect(aapl[0]).toBe(1);
    expect(aapl[1]).toBe("AAPL");
    expect(aapl[2]).toBe("$190.25");
    expect(aapl[10]).toBeNull();
    expect(aapl[11]).toBeNull();

    const msft = byTicker.get("MSFT");
    expect(msft).toHaveLength(12);
    // The extra cell must not exist past index 11.
    expect(msft[11]).toBeNull();
  });

  test("3.1 No Future Actuals: future actual columns (10, 11) remain null (no filling / no computation)", () => {
    const raw = buildFuturePredictionRawResponse();
    const out = normalizeRunStockCheckResponse(raw);

    const byTicker = getTickerToRowMap(out.rows);
    const aapl = byTicker.get("AAPL");

    // Index 10: Actual EOD (Prediction Date) must be null
    expect(aapl[10]).toBeNull();
    // Index 11: % Growth vs Actual must be null
    expect(aapl[11]).toBeNull();
  });

  test("3.2 No Hallucinated Prices: if API returns null for a price, output cell remains null and no calculation is performed", () => {
    const raw = {
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        // Null current / predicted must stay null.
        [1, "AAPL", null, null, null, null, null, null, null, null, null, null]
      ]
    };

    const out = normalizeRunStockCheckResponse(raw);
    const byTicker = getTickerToRowMap(out.rows);
    const aapl = byTicker.get("AAPL");

    // Price/prediction related fields remain null.
    expect(aapl[2]).toBeNull(); // Current EOD Price
    expect(aapl[3]).toBeNull(); // Predicted Price
    expect(aapl[4]).toBeNull(); // Predicted % Growth
    // Future actuals remain null.
    expect(aapl[10]).toBeNull(); // Actual EOD (Prediction Date)
    expect(aapl[11]).toBeNull(); // % Growth vs Actual

    // Additionally assert nothing "computed" sneaked in as a string/number.
    expect(aapl[4]).not.toEqual(expect.stringMatching(/%/));
    expect(aapl[4]).not.toEqual(expect.any(Number));
  });

  test("3.3 Deterministic Output: same inputs + same API payloads => byte-for-byte identical output (stub path)", async () => {
    const payload = { current_date: "2026-01-02", prediction_date: "2026-01-03", macro_override: null };

    const a = await runStockCheck(payload);
    const b = await runStockCheck(payload);

    // Byte-for-byte identical: stringify must match exactly.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("3.4 Overlay Isolation: TRADE/NO_TRADE and Hold/Exit overlays do not change rankings/predictions (core surface)", () => {
    const rawA = {
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        [1, "AAPL", "$190.25", "$191.40", "0.61%", null, null, null, "🟢 Strong", "HOLD", null, null],
        [2, "MSFT", "$410.00", "$412.00", "0.49%", null, null, null, "🟡", null, null, null]
      ]
    };

    // Only overlay fields changed here (header.trade_status, and col 9).
    const rawB = {
      header: { trade_status: "NO_TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        [1, "AAPL", "$190.25", "$191.40", "0.61%", null, null, null, "🟢 Strong", "EXIT", null, null],
        [2, "MSFT", "$410.00", "$412.00", "0.49%", null, null, null, "🟡", "HOLD", null, null]
      ]
    };

    const outA = normalizeRunStockCheckResponse(rawA);
    const outB = normalizeRunStockCheckResponse(rawB);

    const aMap = getTickerToRowMap(outA.rows);
    const bMap = getTickerToRowMap(outB.rows);

    ["AAPL", "MSFT"].forEach((t) => {
      const a = aMap.get(t);
      const b = bMap.get(t);

      // Rank and prediction-related columns must match exactly.
      // Spec phrasing: overlays must not change predictions or rankings.
      // We assert columns 0..8 are invariant.
      for (let idx = 0; idx <= 8; idx += 1) {
        expect(b[idx]).toEqual(a[idx]);
      }
      // Overlay column is allowed to differ.
      expect(b[9]).not.toEqual(a[9]);
    });

    // Fingerprint excludes overlays; must match.
    expect(getOverlayIsolationFingerprint(outA)).toBe(getOverlayIsolationFingerprint(outB));
  });

  test("3.6 INTC Enforcement: INTC always present and rank is enforced to 11", () => {
    const raw = {
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        [1, "AAPL", "$1", "$2", "1%", null, null, null, "Strong", "HOLD", null, null],
        [2, "MSFT", "$1", "$2", "1%", null, null, null, "Strong", "EXIT", null, null]
      ]
    };

    const out = normalizeRunStockCheckResponse(raw);
    const byTicker = getTickerToRowMap(out.rows);

    expect(byTicker.has("INTC")).toBe(true);
    expect(byTicker.get("INTC")[0]).toBe(11);
  });

  test("3.6 INTC Enforcement: if INTC exists but has a different rank, it is forced to 11 and other fields are preserved", () => {
    const raw = {
      header: { trade_status: "NO_TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        [1, "AAPL", "$190", "$191", "0.5%", null, null, null, "🟢 Strong", "HOLD", null, null],
        [5, "INTC", null, null, null, null, null, null, null, "WATCH", null, null]
      ]
    };

    const out = normalizeRunStockCheckResponse(raw);
    const byTicker = getTickerToRowMap(out.rows);
    const intc = byTicker.get("INTC");

    expect(intc[0]).toBe(11);
    // Preserve overlay cell provided by backend (still overlay-only).
    expect(intc[9]).toBe("WATCH");
    // Preserve nulls (no hallucination).
    expect(intc[2]).toBeNull();
    expect(intc[3]).toBeNull();
  });

  test("3.6 INTC Enforcement: INTC is excluded from Top-10 metrics computation (even if positioned in top 10)", () => {
    // Build 11 non-INTC rows + INTC somewhere in the list.
    const rows = [];
    for (let i = 1; i <= 11; i += 1) {
      rows.push([i, `T${i}`, null, null, null, null, null, null, null, null, null, null]);
    }
    // Insert INTC at the top to ensure exclusion is independent of position.
    rows.unshift([999, "INTC", null, null, null, null, null, null, null, null, null, null]);

    const out = normalizeRunStockCheckResponse({
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows
    });

    const top10 = getTop10RowsExcludingIntc(out.rows);

    expect(top10).toHaveLength(10);
    expect(top10.some((r) => String(r?.[1]).toUpperCase() === "INTC")).toBe(false);
  });
});
