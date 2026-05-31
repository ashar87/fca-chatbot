"use client";

import { useState } from "react";

interface FITRSRecord {
  isin: string;
  instrumentName: string;
  liquidityStatus: string;
  adna: string;
  lisThreshold: string;
  sstiThreshold: string;
  calculationPeriod: string;
}

export default function FITRSSearchPage() {
  const [isin, setIsin] = useState("");
  const [result, setResult] = useState<FITRSRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!isin.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/fitrs?isin=${encodeURIComponent(isin)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      if (!data.result) setNotFound(true);
      else setResult(data.result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-sm mb-3" style={{ color: "#555" }}>
        Look up MiFID II transparency calculations — liquidity classifications and LIS/SSTI thresholds.
      </p>

      <form onSubmit={handleSearch} className="fca-form mb-4">
        <div className="fca-form-row-single" style={{ borderTop: "none" }}>
          <div className="fca-label">ISIN</div>
          <div className="fca-field">
            <input
              type="text"
              value={isin}
              onChange={(e) => setIsin(e.target.value.toUpperCase())}
              placeholder="e.g. XS1234567890"
              className="fca-input"
              style={{ fontFamily: "monospace", maxWidth: 200 }}
            />
          </div>
        </div>
        <div className="flex gap-2 p-3 border-t" style={{ borderColor: "#d0d0d0" }}>
          <button type="submit" disabled={loading || !isin.trim()} className="fca-btn-primary">
            {loading ? "Looking up…" : "Look up"}
          </button>
        </div>
      </form>

      {error && (
        <div className="text-sm p-3 mb-3" style={{ background: "#fce8e8", border: "1px solid #e8a0a0", color: "#5c0000" }}>
          {error}
        </div>
      )}
      {notFound && (
        <p className="text-sm" style={{ color: "#555" }}>
          No FITRS data found for ISIN <span style={{ fontFamily: "monospace" }}>{isin}</span>.
        </p>
      )}

      {result && (
        <div style={{ border: "1px solid #d0d0d0", maxWidth: 600 }}>
          <div className="px-3 py-2 text-sm font-bold text-white" style={{ backgroundColor: "var(--fca-purple)" }}>
            {result.instrumentName} — <span style={{ fontFamily: "monospace", fontWeight: "normal" }}>{result.isin}</span>
          </div>
          <table className="fca-table">
            <tbody>
              {[
                ["Liquidity Status", result.liquidityStatus],
                ["ADNA", result.adna],
                ["LIS Threshold", result.lisThreshold],
                ["SSTI Threshold", result.sstiThreshold],
                ["Calculation Period", result.calculationPeriod],
              ].map(([label, value], i) => (
                <tr key={String(label)}>
                  <td style={{ width: 180, fontWeight: "bold", background: i % 2 === 0 ? "#f4f4f4" : "white" }}>{label}</td>
                  <td style={{ background: i % 2 === 0 ? "#f4f4f4" : "white" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!result && !loading && !notFound && !error && (
        <p className="text-sm italic" style={{ color: "#555" }}>Enter an ISIN above to look up transparency thresholds.</p>
      )}
    </div>
  );
}
