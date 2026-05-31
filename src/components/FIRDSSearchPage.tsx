"use client";

import { useState } from "react";

interface Instrument {
  isin: string;
  instrumentName: string;
  cfiCode: string;
  mic: string;
  tradingVenue: string;
  reportable: boolean;
}

export default function FIRDSSearchPage() {
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");
  const [results, setResults] = useState<Instrument[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const params = new URLSearchParams();
      if (isin) params.set("isin", isin);
      if (name) params.set("name", name);
      const res = await fetch(`/api/firds?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setIsin(""); setName(""); setResults(null); setError("");
  }

  return (
    <div>
      <p className="text-sm mb-3" style={{ color: "#555" }}>
        Search UK Financial Instruments Reference Data System — instrument details, ISIN lookup, and MiFIR reportability.
      </p>

      <form onSubmit={handleSearch} className="fca-form mb-4">
        <div className="fca-form-row" style={{ borderTop: "none" }}>
          <div className="fca-label">ISIN</div>
          <div className="fca-field">
            <input
              type="text"
              value={isin}
              onChange={(e) => setIsin(e.target.value.toUpperCase())}
              placeholder="e.g. GB0002875804"
              className="fca-input"
              style={{ fontFamily: "monospace" }}
            />
          </div>
          <div className="fca-label">Instrument name</div>
          <div className="fca-field">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Barclays"
              className="fca-input"
            />
          </div>
        </div>

        <div className="flex gap-2 p-3 border-t" style={{ borderColor: "#d0d0d0" }}>
          <button type="submit" disabled={loading || (!isin && !name)} className="fca-btn-primary">
            {loading ? "Searching…" : "Search"}
          </button>
          <button type="button" onClick={handleReset} className="fca-btn-secondary">Reset</button>
        </div>
      </form>

      {error && (
        <div className="text-sm p-3 mb-3" style={{ background: "#fce8e8", border: "1px solid #e8a0a0", color: "#5c0000" }}>
          {error}
        </div>
      )}

      {results !== null && results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="fca-table">
            <thead>
              <tr>
                <th>ISIN</th>
                <th>Name</th>
                <th>CFI Code</th>
                <th>MIC</th>
                <th>Trading Venue</th>
                <th>MiFIR Reportable</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.isin}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.isin}</td>
                  <td>{r.instrumentName}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.cfiCode}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.mic}</td>
                  <td>{r.tradingVenue}</td>
                  <td>
                    <span style={{
                      padding: "1px 8px",
                      fontSize: "0.75rem",
                      fontWeight: "bold",
                      background: r.reportable ? "#d4edda" : "#f4f4f4",
                      color: r.reportable ? "#155724" : "#555",
                      border: `1px solid ${r.reportable ? "#c3e6cb" : "#ccc"}`,
                    }}>
                      {r.reportable ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results !== null && results.length === 0 && (
        <p className="text-sm" style={{ color: "#555" }}>No instruments found.</p>
      )}

      {results === null && !loading && (
        <p className="text-sm italic" style={{ color: "#555" }}>Enter an ISIN or instrument name to search FIRDS data.</p>
      )}
    </div>
  );
}
