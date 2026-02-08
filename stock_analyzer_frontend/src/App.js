import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import { runStockCheck } from "./api/stockCheckClient";
import {
  getCanonicalColumns,
  getOverlayIsolationFingerprint,
  getTop10RowsExcludingIntc,
  normalizeRunStockCheckResponse
} from "./stockCheckSchema";

/**
 * Stock Check (43-Factor Model) dashboard UI.
 * This file intentionally contains UI + local state only.
 * In this step, we add API wiring for POST /run-stock-check with a deterministic fallback stub.
 */

const MACRO_OVERRIDE_OPTIONS = [
  { value: "", label: "Off (Recommended)" },
  { value: "NO_TRADE", label: "NO_TRADE" }
];

const CANONICAL_COLUMNS = getCanonicalColumns();

function formatTodayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// PUBLIC_INTERFACE
function App() {
  /** This is the Stock Check dashboard UI root component. */
  const [theme, setTheme] = useState("light");

  // Inputs per runbook/spec
  const [currentDate, setCurrentDate] = useState(formatTodayISO());
  const [predictionDate, setPredictionDate] = useState(addDaysISO(formatTodayISO(), 1));
  const [macroOverride, setMacroOverride] = useState("");

  // UI state placeholders (will be replaced by real API call results)
  const [isRunning, setIsRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [error, setError] = useState("");

  // Placeholder for future response rendering
  const [result, setResult] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const canRun = useMemo(() => {
    return Boolean(currentDate) && Boolean(predictionDate) && !isRunning;
  }, [currentDate, predictionDate, isRunning]);

  const top10ExIntcCount = useMemo(() => {
    if (!result?.rows) return null;
    return getTop10RowsExcludingIntc(result.rows).length;
  }, [result]);

  const overlayIsolationFingerprint = useMemo(() => {
    return getOverlayIsolationFingerprint(result);
  }, [result]);

  // PUBLIC_INTERFACE
  const toggleTheme = () => {
    /** Toggle between light and dark themes. */
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  // PUBLIC_INTERFACE
  const onRun = async () => {
    /**
     * Trigger a Stock Check run via POST /run-stock-check.
     *
     * Failure handling (per spec):
     * - No retries across time.
     * - If backend is unreachable / times out / returns non-2xx:
     *   return deterministic null-preserving stub output.
     */
    setError("");
    setIsRunning(true);

    try {
      const payload = {
        current_date: currentDate,
        prediction_date: predictionDate,
        macro_override: macroOverride ? macroOverride : null
      };

      const apiResult = await runStockCheck(payload);
      const normalized = normalizeRunStockCheckResponse(apiResult);

      setLastRunAt(new Date());
      setResult(normalized);
    } catch (e) {
      // runStockCheck already falls back deterministically; this catch is a final safety net.
      setError("Failed to run Stock Check. Please try again.");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="App">
      <div className="sc-shell">
        <aside className="sc-sidebar" aria-label="Primary navigation">
          <div className="sc-brand">
            <div className="sc-mark" aria-hidden="true">
              SC
            </div>
            <div className="sc-brand-text">
              <div className="sc-brand-title">Stock Check</div>
              <div className="sc-brand-subtitle">43-Factor Model</div>
            </div>
          </div>

          <nav className="sc-nav">
            <button className="sc-nav-item sc-nav-item--active" type="button">
              Dashboard
            </button>
            <button className="sc-nav-item" type="button" disabled aria-disabled="true">
              History (coming soon)
            </button>
            <button className="sc-nav-item" type="button" disabled aria-disabled="true">
              Settings (coming soon)
            </button>
          </nav>

          <div className="sc-sidebar-footer">
            <button
              className="sc-theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              type="button"
            >
              Theme: {theme === "light" ? "Light" : "Dark"}
            </button>
            <div className="sc-meta">
              <div className="sc-meta-kv">
                <span className="sc-meta-k">Environment</span>
                <span className="sc-meta-v">{process.env.REACT_APP_NODE_ENV || "unknown"}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="sc-main">
          <header className="sc-topbar">
            <div>
              <h1 className="sc-h1">Run Stock Check</h1>
              <p className="sc-subtitle">
                Select dates, optionally apply a macro override, then run. Blanks in results are a feature (data may not exist yet).
              </p>
            </div>

            <div className="sc-topbar-actions">
              <button className="sc-btn sc-btn--primary" onClick={onRun} disabled={!canRun} type="button">
                {isRunning ? "Running…" : "Run"}
              </button>
            </div>
          </header>

          <section className="sc-grid">
            <div className="sc-card">
              <div className="sc-card-header">
                <h2 className="sc-h2">Inputs</h2>
                <p className="sc-card-help">Per runbook: Current Date should be the last market close. Prediction Date can be future.</p>
              </div>

              <div className="sc-form">
                <label className="sc-field">
                  <span className="sc-label">Current Date (last market close)</span>
                  <input
                    className="sc-input"
                    type="date"
                    value={currentDate}
                    onChange={(e) => setCurrentDate(e.target.value)}
                    required
                  />
                </label>

                <label className="sc-field">
                  <span className="sc-label">Prediction Date</span>
                  <input
                    className="sc-input"
                    type="date"
                    value={predictionDate}
                    onChange={(e) => setPredictionDate(e.target.value)}
                    required
                  />
                </label>

                <label className="sc-field">
                  <span className="sc-label">Macro Override</span>
                  <select
                    className="sc-input"
                    value={macroOverride}
                    onChange={(e) => setMacroOverride(e.target.value)}
                  >
                    {MACRO_OVERRIDE_OPTIONS.map((opt) => (
                      <option key={opt.value || "empty"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="sc-field-hint">
                    Leave OFF unless markets are broken. Only allowed override is <code>NO_TRADE</code>.
                  </span>
                </label>

                {error ? (
                  <div className="sc-alert sc-alert--error" role="alert">
                    {error}
                  </div>
                ) : null}

                <div className="sc-form-actions">
                  <button className="sc-btn" type="button" onClick={onRun} disabled={!canRun}>
                    {isRunning ? "Running…" : "Run Stock Check"}
                  </button>
                  <div className="sc-run-meta" aria-live="polite">
                    {lastRunAt ? (
                      <>
                        Last run:{" "}
                        <span className="sc-mono">
                          {lastRunAt.toLocaleString()}
                        </span>
                      </>
                    ) : (
                      "Not run yet"
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="sc-card">
              <div className="sc-card-header">
                <h2 className="sc-h2">Summary</h2>
                <p className="sc-card-help">This header mirrors the strict response schema.</p>
              </div>

              <div className="sc-summary">
                <div className="sc-summary-item">
                  <div className="sc-summary-k">Trade Status</div>
                  <div className="sc-summary-v">
                    {result?.header?.trade_status ? (
                      <span
                        className={
                          result.header.trade_status === "TRADE"
                            ? "sc-pill sc-pill--good"
                            : "sc-pill"
                        }
                      >
                        {result.header.trade_status}
                      </span>
                    ) : (
                      <span className="sc-muted">—</span>
                    )}
                  </div>
                </div>

                <div className="sc-summary-item">
                  <div className="sc-summary-k">Avg Predicted Growth</div>
                  <div className="sc-summary-v">
                    {result?.header?.avg_predicted_growth ?? <span className="sc-muted">—</span>}
                  </div>
                </div>

                <div className="sc-summary-item">
                  <div className="sc-summary-k">Dispersion</div>
                  <div className="sc-summary-v">
                    {result?.header?.dispersion ?? <span className="sc-muted">—</span>}
                  </div>
                </div>

                <div className="sc-summary-item">
                  <div className="sc-summary-k">Sector Warning</div>
                  <div className="sc-summary-v">
                    {typeof result?.header?.sector_warning === "boolean" ? (
                      result.header.sector_warning ? (
                        <span className="sc-pill sc-pill--warn">TRUE</span>
                      ) : (
                        <span className="sc-pill sc-pill--good">FALSE</span>
                      )
                    ) : (
                      <span className="sc-muted">—</span>
                    )}
                  </div>
                </div>

                <div className="sc-summary-item">
                  <div className="sc-summary-k">Top-10 Rows (ex INTC)</div>
                  <div className="sc-summary-v">
                    {typeof top10ExIntcCount === "number" ? top10ExIntcCount : <span className="sc-muted">—</span>}
                  </div>
                </div>

                <div className="sc-summary-item">
                  <div className="sc-summary-k">Overlay-Isolation Fingerprint</div>
                  <div className="sc-summary-v">
                    {overlayIsolationFingerprint ? (
                      <span className="sc-mono" title={overlayIsolationFingerprint}>
                        {overlayIsolationFingerprint.slice(0, 32)}…
                      </span>
                    ) : (
                      <span className="sc-muted">—</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="sc-callout">
                <strong>Critical warning:</strong> blanks mean data does not exist yet. Do not assume missing data will go your way.
              </div>
            </div>
          </section>

          <section className="sc-card sc-table-card" aria-label="Results table">
            <div className="sc-card-header">
              <h2 className="sc-h2">Results</h2>
              <p className="sc-card-help">
                Rows are rendered in canonical array order (12 columns, order-locked). This table is scaffolded until backend wiring is added.
              </p>
            </div>

            <div className="sc-table-wrap">
              <table className="sc-table">
                <thead>
                  <tr>
                    {CANONICAL_COLUMNS.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result?.rows?.length ? (
                    result.rows.map((row, idx) => (
                      <tr key={idx}>
                        {CANONICAL_COLUMNS.map((_, colIdx) => {
                          const v = row?.[colIdx];
                          const isNullish = v === null || typeof v === "undefined";
                          return (
                            <td key={colIdx} className={colIdx === 1 ? "sc-td-ticker" : undefined}>
                              {isNullish ? <span className="sc-muted">—</span> : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={CANONICAL_COLUMNS.length} className="sc-empty">
                        Run the Stock Check to populate results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sc-footer-note">
            <h3 className="sc-h3">How to read results</h3>
            <ul className="sc-bullets">
              <li>
                <strong>TRADE</strong> = model sees opportunity today.
              </li>
              <li>
                <strong>NO TRADE</strong> = do nothing, even if names look exciting.
              </li>
              <li>
                <strong>HOLD / WATCH / EXIT</strong> are overlays; they must not change predictions or rankings.
              </li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
