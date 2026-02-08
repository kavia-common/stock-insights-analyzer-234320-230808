import { normalizeRunStockCheckResponse } from "./stockCheckSchema";

function getTickerToRowMap(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const t = r?.[1];
    if (typeof t === "string") map.set(t.trim().toUpperCase(), r);
  });
  return map;
}

describe("Stock Check compliance: INTC + overlay isolation", () => {
  test("INTC is always present and rank is enforced to 11", () => {
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

  test("If INTC exists but has a different rank, it is forced to 11 and other fields are preserved", () => {
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

  test("Overlay isolation: changing TRADE/NO_TRADE or Hold/Exit overlay must not change rank/prediction fields", () => {
    const baseRows = [
      [1, "AAPL", "$190.25", "$191.40", "0.61%", null, null, null, "🟢 Strong", "HOLD", null, null],
      [2, "MSFT", "$410.00", "$412.00", "0.49%", null, null, null, "🟡", null, null, null]
    ];

    const rawA = {
      header: { trade_status: "TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: baseRows
    };

    // Only overlay fields changed here:
    const rawB = {
      header: { trade_status: "NO_TRADE", avg_predicted_growth: null, dispersion: null, sector_warning: false },
      rows: [
        // same ranking + prediction cells, different overlay cells
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

      // Rank and prediction-related columns (0..8 excluding overlay at 9) must match.
      // Specifically: Rank(0), Ticker(1), EOD(2), Predicted(3), Predicted% (4), 3m/6m/12m (5-7), Signal(8)
      for (let idx = 0; idx <= 8; idx += 1) {
        expect(b[idx]).toEqual(a[idx]);
      }
    });

    // Also ensure the normalizer didn't reorder these rows due to header changes.
    expect(outA.rows[0][1]).toBe("AAPL");
    expect(outB.rows[0][1]).toBe("AAPL");
  });
});
