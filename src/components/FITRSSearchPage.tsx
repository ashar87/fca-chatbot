"use client";

import { useState } from "react";

interface FITRSFile {
  fileName: string;
  fileType: string;
  instrumentType: string;
  publicationDate: string;
  downloadLink: string;
  lastRefreshed: string;
}

interface FITRSRecord {
  techRecordId: string;
  isin: string;
  classification: string;
  fullName: string;
  liquid: boolean;
  methodology: string;
  reportingPeriodFrom: string;
  reportingPeriodTo: string;
  avgDailyTurnover: string;
  avgDailyTurnoverCcy: string;
  largeInScale: string;
  avgDailyTxCount: string;
  relevantMarket: string;
  relevantMarketAvgDailyTxCount: string;
}

interface ExpandedFile {
  loading: boolean;
  error: string;
  records: FITRSRecord[];
  filter: string;
}

export default function FITRSSearchPage() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [fileType, setFileType] = useState<"" | "Full" | "Delta">("");
  const [results, setResults] = useState<FITRSFile[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, ExpandedFile>>({});

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults(null);
    setTotal(null);
    setExpanded({});
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (fileType) params.set("file_type", fileType);
      const res = await fetch(`/api/fitrs?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.files ?? []);
      setTotal(data.total ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setDateFrom(thirtyDaysAgo);
    setDateTo(today);
    setFileType("");
    setResults(null);
    setTotal(null);
    setError("");
    setExpanded({});
  }

  async function handleExpand(fileName: string, downloadLink: string) {
    // Collapse if already expanded
    if (expanded[fileName]?.records.length > 0 || expanded[fileName]?.error) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[fileName];
        return next;
      });
      return;
    }

    setExpanded((prev) => ({ ...prev, [fileName]: { loading: true, error: "", records: [], filter: "" } }));
    try {
      const res = await fetch(`/api/fitrs-file?url=${encodeURIComponent(downloadLink)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load file");
      setExpanded((prev) => ({ ...prev, [fileName]: { loading: false, error: "", records: data.records ?? [], filter: "" } }));
    } catch (err: unknown) {
      setExpanded((prev) => ({ ...prev, [fileName]: { loading: false, error: (err as Error).message, records: [], filter: "" } }));
    }
  }

  function setFilter(fileName: string, value: string) {
    setExpanded((prev) => ({ ...prev, [fileName]: { ...prev[fileName], filter: value } }));
  }

  return (
    <div>
      <p className="text-sm mb-3" style={{ color: "#555" }}>
        Browse FCA FITRS transparency calculation result files. Full files are published weekly (Saturday);
        delta files are published daily when changes occur. Click &ldquo;View Records&rdquo; to extract and browse instruments inside a file.
      </p>

      <form onSubmit={handleSearch} className="fca-form mb-4">
        <div className="fca-form-row" style={{ borderTop: "none" }}>
          <div className="fca-label">Publication Date</div>
          <div className="fca-field flex items-center gap-2">
            <label className="text-xs text-gray-500 mr-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="fca-input" style={{ width: 140 }} />
            <label className="text-xs text-gray-500 mx-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="fca-input" style={{ width: 140 }} />
          </div>
          <div className="fca-label">File Type</div>
          <div className="fca-field">
            <select className="fca-select" value={fileType} onChange={(e) => setFileType(e.target.value as "" | "Full" | "Delta")}>
              <option value="">All</option>
              <option value="Full">Full</option>
              <option value="Delta">Delta</option>
            </select>
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

      {results !== null && (
        <div>
          <p className="text-sm mb-2" style={{ color: "var(--fca-text)" }}>
            {results.length === 0
              ? "No files found for the selected date range."
              : <>
                  Showing <strong>{results.length}</strong> file{results.length !== 1 ? "s" : ""}
                  {total !== null && total > results.length && <> of <strong>{total.toLocaleString()}</strong> total</>}
                </>
            }
          </p>

          {results.length > 0 && (
            <div>
              <table className="fca-table mb-0">
                <thead>
                  <tr>
                    <th>File Name</th>
                    <th>Type</th>
                    <th>Instrument Type</th>
                    <th>Publication Date</th>
                    <th>Last Refreshed</th>
                    <th>Download</th>
                    <th>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const exp = expanded[r.fileName];
                    const isExpanded = !!exp;
                    const filteredRecords = exp?.filter
                      ? exp.records.filter((rec) =>
                          rec.isin.toLowerCase().includes(exp.filter.toLowerCase()) ||
                          rec.fullName.toLowerCase().includes(exp.filter.toLowerCase()) ||
                          rec.classification.toLowerCase().includes(exp.filter.toLowerCase())
                        )
                      : exp?.records ?? [];

                    return (
                      <>
                        <tr key={`${r.fileName}-${i}`}>
                          <td style={{ fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "nowrap" }}>{r.fileName}</td>
                          <td>
                            <span style={{
                              padding: "1px 8px", fontSize: "0.75rem", fontWeight: "bold",
                              background: r.fileType === "Full" ? "#d4edda" : "#fff3cd",
                              color: r.fileType === "Full" ? "#155724" : "#856404",
                              border: `1px solid ${r.fileType === "Full" ? "#c3e6cb" : "#ffeeba"}`,
                            }}>
                              {r.fileType}
                            </span>
                          </td>
                          <td>{r.instrumentType}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.publicationDate}</td>
                          <td style={{ whiteSpace: "nowrap", fontSize: "0.75rem" }}>{r.lastRefreshed.slice(0, 19).replace("T", " ")}</td>
                          <td>
                            <a href={r.downloadLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fca-link)", fontSize: "0.75rem" }}>
                              ZIP →
                            </a>
                          </td>
                          <td>
                            <button
                              onClick={() => handleExpand(r.fileName, r.downloadLink)}
                              disabled={exp?.loading}
                              className="fca-btn-secondary"
                              style={{ fontSize: "0.7rem", padding: "2px 8px" }}
                            >
                              {exp?.loading ? "Loading…" : isExpanded ? "Collapse" : "View Records"}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded records panel */}
                        {isExpanded && (
                          <tr key={`${r.fileName}-expanded`}>
                            <td colSpan={7} style={{ padding: 0, background: "#f9f9f9", borderTop: "2px solid var(--fca-purple)" }}>
                              {exp.error ? (
                                <div className="text-sm p-3" style={{ color: "#5c0000" }}>{exp.error}</div>
                              ) : (
                                <div className="p-3">
                                  <div className="flex items-center gap-3 mb-2">
                                    <span className="text-xs font-bold" style={{ color: "var(--fca-text)" }}>
                                      {exp.records.length.toLocaleString()} instrument record{exp.records.length !== 1 ? "s" : ""}
                                    </span>
                                    <input
                                      type="text"
                                      placeholder="Filter by ISIN, name, or classification…"
                                      value={exp.filter}
                                      onChange={(e) => setFilter(r.fileName, e.target.value)}
                                      className="fca-input"
                                      style={{ maxWidth: 320, fontSize: "0.75rem", padding: "3px 8px" }}
                                    />
                                    {exp.filter && (
                                      <span className="text-xs text-gray-500">
                                        {filteredRecords.length.toLocaleString()} match{filteredRecords.length !== 1 ? "es" : ""}
                                      </span>
                                    )}
                                  </div>

                                  <div className="overflow-x-auto" style={{ maxHeight: 400, overflowY: "auto" }}>
                                    <table className="fca-table" style={{ fontSize: "0.72rem" }}>
                                      <thead>
                                        <tr>
                                          <th>ISIN</th>
                                          <th>Full Name</th>
                                          <th>Classification</th>
                                          <th>Liquid</th>
                                          <th>Methodology</th>
                                          <th>Avg Daily Turnover</th>
                                          <th>Large-in-Scale</th>
                                          <th>Avg Daily Tx</th>
                                          <th>Relevant Market</th>
                                          <th>Reporting Period</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {filteredRecords.slice(0, 200).map((rec) => (
                                          <tr key={rec.techRecordId}>
                                            <td style={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{rec.isin}</td>
                                            <td style={{ maxWidth: 200 }}>{rec.fullName || "—"}</td>
                                            <td style={{ fontFamily: "monospace" }}>{rec.classification}</td>
                                            <td>
                                              <span style={{
                                                padding: "1px 6px", fontWeight: "bold",
                                                background: rec.liquid ? "#d4edda" : "#f4f4f4",
                                                color: rec.liquid ? "#155724" : "#555",
                                                border: `1px solid ${rec.liquid ? "#c3e6cb" : "#ccc"}`,
                                              }}>
                                                {rec.liquid ? "Yes" : "No"}
                                              </span>
                                            </td>
                                            <td style={{ fontFamily: "monospace" }}>{rec.methodology}</td>
                                            <td style={{ whiteSpace: "nowrap" }}>
                                              {rec.avgDailyTurnover
                                                ? `${rec.avgDailyTurnoverCcy} ${Number(rec.avgDailyTurnover).toLocaleString()}`
                                                : "—"}
                                            </td>
                                            <td>{rec.largeInScale ? Number(rec.largeInScale).toLocaleString() : "—"}</td>
                                            <td>{rec.avgDailyTxCount || "—"}</td>
                                            <td style={{ fontFamily: "monospace" }}>{rec.relevantMarket || "—"}</td>
                                            <td style={{ whiteSpace: "nowrap", fontSize: "0.68rem" }}>
                                              {rec.reportingPeriodFrom
                                                ? `${rec.reportingPeriodFrom} → ${rec.reportingPeriodTo}`
                                                : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {filteredRecords.length > 200 && (
                                      <p className="text-xs p-2 text-gray-500">
                                        Showing first 200 of {filteredRecords.length.toLocaleString()} records. Use the filter to narrow results.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {results === null && !loading && (
        <p className="text-sm italic" style={{ color: "#555" }}>
          Select a date range to browse available FITRS transparency files.
        </p>
      )}
    </div>
  );
}
