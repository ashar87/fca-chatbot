"use client";

import { useState } from "react";

interface Instrument {
  isin: string;
  instrumentId: string;
  instrumentName: string;
  shortName: string;
  cfiCode: string;
  mic: string;
  issuerLei: string;
  currency: string;
  firstTradeDate: string;
  reportable: boolean;
  detailUrl: string;
}

export default function FIRDSSearchPage() {
  const [isin, setIsin] = useState("");
  const [instrumentId, setInstrumentId] = useState("");
  const [issuerLei, setIssuerLei] = useState("");
  const [classification, setClassification] = useState("");
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
      if (instrumentId) params.set("instrument_id", instrumentId);
      if (issuerLei) params.set("issuer_lei", issuerLei);
      if (classification) params.set("classification", classification);
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
    setIsin(""); setInstrumentId(""); setIssuerLei(""); setClassification(""); setName(""); setResults(null); setError("");
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
          <div className="fca-label">Instrument ID</div>
          <div className="fca-field">
            <input
              type="text"
              value={instrumentId}
              onChange={(e) => setInstrumentId(e.target.value.toUpperCase())}
              placeholder="e.g. BRTCCOBDR002"
              className="fca-input"
              style={{ fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="fca-form-row">
          <div className="fca-label">Instrument name</div>
          <div className="fca-field">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tesco, Barclays"
              className="fca-input"
            />
          </div>
          <div className="fca-label">Issuer LEI</div>
          <div className="fca-field">
            <input
              type="text"
              value={issuerLei}
              onChange={(e) => setIssuerLei(e.target.value.toUpperCase())}
              placeholder="e.g. ML61HP3A4MKTTA1ZB671"
              className="fca-input"
              style={{ fontFamily: "monospace" }}
            />
          </div>
        </div>

        <div className="fca-form-row">
          <div className="fca-label">Classification (CFI)</div>
          <div className="fca-field">
            <input
              type="text"
              value={classification}
              onChange={(e) => setClassification(e.target.value.toUpperCase())}
              placeholder="e.g. ESVTFR"
              className="fca-input"
              style={{ fontFamily: "monospace" }}
            />
          </div>
          <div />
          <div />
        </div>

        <div className="flex gap-2 p-3 border-t" style={{ borderColor: "#d0d0d0" }}>
          <button type="submit" disabled={loading || (!isin && !instrumentId && !issuerLei && !classification && !name)} className="fca-btn-primary">
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
                <th>Full Name</th>
                <th>Short Name</th>
                <th>CFI Code</th>
                <th>MIC</th>
                <th>Currency</th>
                <th>First Trade</th>
                <th>Issuer LEI</th>
                <th>MiFIR Reportable</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.instrumentId}-${i}`}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{r.isin || "—"}</td>
                  <td style={{ maxWidth: 220 }}>{r.instrumentName}</td>
                  <td style={{ maxWidth: 160, fontSize: "0.75rem" }}>{r.shortName}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.cfiCode}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.mic}</td>
                  <td>{r.currency}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }}>{r.firstTradeDate}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{r.issuerLei}</td>
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
                  <td>
                    {r.detailUrl && (
                      <a href={r.detailUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fca-link)" }}>
                        View →
                      </a>
                    )}
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
