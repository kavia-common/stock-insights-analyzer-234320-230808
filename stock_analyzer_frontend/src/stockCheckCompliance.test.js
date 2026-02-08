import { runStockCheck } from "./api/stockCheckClient";
import {
  CANONICAL_COLUMNS,
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
 * Minimal "today" mock for tests that need "prediction date > today".
 * We don't depend on actual current time; the compliance rule we test is:
 * if backend gives null for future actuals, we must preserve nulls and not compute.
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

describe("Stock Check forward-mode compliance suite", () => {
  test("Column Order Lock: every normalized row is exactly 12 cells and mapping is stable", () => {
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

    out.rows.forEach((row) => {
      expect(Array.isArray(row)).toBe(true);
      expect(row).toHaveLength(CANONICAL_COLUMNS.length);
    });

    const byTicker = getTickerToRowMap(out.rows);
    const aapl = byTicker.get("AAPL");
    expect(aapl).toHaveLength(12);

    // Spot-check canonical positions so index-to-column mapping stays unchanged.
    // Index 0: Rank, 1: Ticker, 2: Current EOD Price
    expect(aapl[0]).toBe(1);
    expect(aapl[1]).toBe("AAPL");
    expect(aapl[2]).toBe("$190.25");
    // Index 10/11 should exist and be null due to padding
    expect(aapl[10]).toBeNull();
    expect(aapl[11]).toBeNull();

    const msft = byTicker.get("MSFT");
    expect(msft).toHaveLength(12);
    // The extra cell must not exist past index 11
    expect(msft[11]).toBeNull();
  });

  test("No Future Actuals: future actual columns (10, 11) remain null (no filling / no computation)", () => {
    const raw = buildFuturePredictionRawResponse();
    const out = normalizeRunStockCheckResponse(raw);

    const byTicker = getTickerToRowMap(out.rows);
    const aapl = byTicker.get("AAPL");

    // Index 10: Actual EOD (Prediction Date) must be null
    expect(aapl[10]).toBeNull();
    // Index 11: % Growth vs Actual must be null
    expect(aapl[11]).toBeNull();
  });

  test("No Hallucinated Prices: if API returns nulls, output remains null and is not replaced", () => {
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

    expect(aapl[2]).toBeNull(); // Current EOD Price
    expect(aapl[3]).toBeNull(); // Predicted Price
    expect(aapl[4]).toBeNull(); // Predicted % Growth
    expect(aapl[10]).toBeNull(); // Actual EOD (Prediction Date)
    expect(aapl[11]).toBeNull(); // % Growth vs Actual
  });

  test("Deterministic Output: same inputs + same API payloads => byte-for-byte identical output (stub path)", async () => {
    // In tests, base URL is typically not set, so runStockCheck will return deterministic stub.
    const payload = { current_date: "2026-01-02", prediction_date: "2026-01-03", macro_override: null };

    const a = await runStockCheck(payload);
    const b = await runStockCheck(payload);

    // Byte-for-byte identical: stringify must match exactly.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("Overlay Isolation: changing TRADE/NO_TRADE or Hold/Exit overlay must not change rank/prediction fields", () => {
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
      // Specifically: 0..8 (Rank..Signal) are "core surface" and must not change.
      for (let idx = 0; idx <= 8; idx += 1) {
        expect(b[idx]).toEqual(a[idx]);
      }
    });

    // Also ensure the normalizer didn't reorder these rows due to header changes.
    expect(outA.rows[0][1]).toBe("AAPL");
    expect(outB.rows[0][1]).toBe("AAPL");
  });

  test("INTC Enforcement: INTC always present and rank is enforced to 11", () => {
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

  test("INTC Enforcement: if INTC exists but has a different rank, it is forced to 11 and other fields are preserved", () => {
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

  test("INTC Enforcement: INTC is excluded from Top-10 metrics computation", () => {
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
