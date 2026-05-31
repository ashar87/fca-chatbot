"use client";

import { useState } from "react";

interface ShortPosition {
  issuerName: string;
  positionHolder: string;
  netShortPosition: string;
  dateOfPosition: string;
  dateOfDisclosure: string;
}

export default function ShortSellingPage() {
  const [issuer, setIssuer] = useState("");
  const [threshold, setThreshold] = useState("");
  const [results, setResults] = useState<ShortPosition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const params = new URLSearchParams();
      if (issuer) params.set("issuer", issuer);
      if (threshold) params.set("threshold", threshold);
      const res = await fetch(`/api/short-selling?${params}`);
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
    setIssuer(""); setThreshold(""); setResults(null); setError("");
  }

  return (
    <div>
      <p className="text-sm mb-3" style={{ color: "#555" }}>
        Search disclosed net short positions. Positions are updated daily from the FCA Short Selling Register.
      </p>

      <form onSubmit={handleSearch} className="fca-form mb-4">
        <div className="fca-form-row" style={{ borderTop: "none" }}>
          <div className="fca-label">Issuer / Company</div>
          <div className="fca-field">
            <input
              type="text"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="e.g. Rolls-Royce"
              className="fca-input"
            />
          </div>
          <div className="fca-label">Minimum position (%)</div>
          <div className="fca-field">
            <input
              type="number"
              step="0.1"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="e.g. 0.5"
              className="fca-input"
              style={{ maxWidth: 100 }}
            />
          </div>
        </div>

        <div className="flex gap-2 p-3 border-t" style={{ borderColor: "#d0d0d0" }}>
          <button type="submit" disabled={loading} className="fca-btn-primary">
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
                <th>Issuer</th>
                <th>Position Holder</th>
                <th>Net Short Position</th>
                <th>Date of Position</th>
                <th>Date Disclosed</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.issuerName}-${r.positionHolder}-${i}`}>
                  <td style={{ fontWeight: "bold" }}>{r.issuerName}</td>
                  <td>{r.positionHolder}</td>
                  <td style={{ fontWeight: "bold" }}>{r.netShortPosition}%</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.dateOfPosition}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.dateOfDisclosure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results !== null && results.length === 0 && (
        <p className="text-sm" style={{ color: "#555" }}>No disclosed positions found.</p>
      )}

      {results === null && !loading && (
        <p className="text-sm italic" style={{ color: "#555" }}>Search by issuer name or minimum position threshold.</p>
      )}
    </div>
  );
}
