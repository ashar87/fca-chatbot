"use client";

import { useState } from "react";

interface Filing {
  id: string;
  title: string;
  company: string;
  filingType: string;
  source: string;
  date: string;
  url: string;
  relatedOrgs?: string[];
}

type MatchMode = "exact_match" | "all_words" | "any_word";

function DateRange({ label, from, to, onFrom, onTo }: {
  label: string;
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  return (
    <div className="fca-form-row">
      <div className="fca-label">{label}</div>
      <div className="fca-field flex items-center gap-2">
        <label className="text-xs text-gray-500 mr-1">From</label>
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="fca-input" style={{ width: 130 }} />
        <label className="text-xs text-gray-500 mx-1">To</label>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="fca-input" style={{ width: 130 }} />
      </div>
      <div />
      <div />
    </div>
  );
}

export default function NSMSearchPage() {
  // Document text
  const [docText, setDocText] = useState("");
  const [matchMode, setMatchMode] = useState<MatchMode>("exact_match");
  const [docDescription, setDocDescription] = useState("");

  // Information type
  const [source, setSource] = useState("");

  // Company
  const [includeDisclosing, setIncludeDisclosing] = useState(true);
  const [includeRelated, setIncludeRelated] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [orgLEI, setOrgLEI] = useState("");

  // Time period
  const [filingDateFrom, setFilingDateFrom] = useState("");
  const [filingDateTo, setFilingDateTo] = useState("");
  const [pubDateFrom, setPubDateFrom] = useState("");
  const [pubDateTo, setPubDateTo] = useState("");

  // Results
  const [results, setResults] = useState<Filing[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResults(null);
    setTotal(null);

    try {
      const params = new URLSearchParams();

      // Determine search mode priority: LEI > org name > document text
      if (orgLEI.trim()) {
        params.set("lei", orgLEI.trim());
        params.set("mode", "lei");
      } else if (orgName.trim()) {
        params.set("query", orgName.trim());
        params.set("mode", "company");
      } else if (docText.trim()) {
        params.set("keywords", docText.trim());
        params.set("mode", "content");
        params.set("match_mode", matchMode);
      } else {
        setError("Please enter at least one search criterion.");
        setLoading(false);
        return;
      }

      if (source) params.set("source", source);
      if (filingDateFrom) params.set("date_from", filingDateFrom);
      if (filingDateTo) params.set("date_to", filingDateTo);
      if (pubDateFrom) params.set("pub_date_from", pubDateFrom);
      if (pubDateTo) params.set("pub_date_to", pubDateTo);
      if (!includeDisclosing) params.set("exclude_disclosing", "true");
      if (!includeRelated) params.set("exclude_related", "true");

      const res = await fetch(`/api/nsm?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results ?? []);
      setTotal(data.total ?? data.results?.length ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setDocText(""); setMatchMode("exact_match"); setDocDescription("");
    setSource(""); setIncludeDisclosing(true); setIncludeRelated(true);
    setOrgName(""); setOrgLEI("");
    setFilingDateFrom(""); setFilingDateTo("");
    setPubDateFrom(""); setPubDateTo("");
    setResults(null); setTotal(null); setError("");
  }

  return (
    <div>
      <form onSubmit={handleSearch} className="fca-form mb-4">
        {/* ── Document Text ───────────────────────────────── */}
        <div className="fca-form-row" style={{ borderTop: "none" }}>
          <div className="fca-label">Document Text</div>
          <div className="fca-field">
            <input
              type="text"
              value={docText}
              onChange={(e) => setDocText(e.target.value)}
              placeholder="Maximum 5 words allowed"
              className="fca-input"
            />
          </div>
          <div className="fca-label">Document Description</div>
          <div className="fca-field">
            <input
              type="text"
              value={docDescription}
              onChange={(e) => setDocDescription(e.target.value)}
              className="fca-input"
            />
          </div>
        </div>

        {/* Match mode radio */}
        <div className="fca-form-row">
          <div className="fca-label" style={{ alignSelf: "flex-start", paddingTop: 8 }}>
            Show results with:
          </div>
          <div className="fca-field" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {(["exact_match", "all_words", "any_word"] as MatchMode[]).map((m) => (
              <label key={m} className="flex items-center gap-2 mb-1 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="matchMode"
                  value={m}
                  checked={matchMode === m}
                  onChange={() => setMatchMode(m)}
                  style={{ accentColor: "var(--fca-purple)" }}
                />
                {m === "exact_match" ? "Exact match" : m === "all_words" ? "All words match" : "Any word match"}
              </label>
            ))}
          </div>
          <div />
          <div />
        </div>

        {/* ── Information Type ─────────────────────────────── */}
        <div className="fca-form-section-header">Information Type</div>

        <div className="fca-form-row">
          <div className="fca-label">Category</div>
          <div className="fca-field">
            <select className="fca-select" disabled>
              <option value="">Please select</option>
            </select>
          </div>
          <div className="fca-label">Source</div>
          <div className="fca-field">
            <select className="fca-select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Please select</option>
              <option value="RNS">RNS</option>
              <option value="EQS">EQS</option>
              <option value="Direct Upload">Direct Upload</option>
              <option value="FCA">FCA</option>
            </select>
          </div>
        </div>

        <div className="fca-form-row">
          <div className="fca-label">ESEF AFR Type</div>
          <div className="fca-field">
            <select className="fca-select" disabled>
              <option value="">Please select</option>
            </select>
          </div>
          <div />
          <div />
        </div>

        {/* ── Company ──────────────────────────────────────── */}
        <div className="fca-form-section-header">Company</div>

        <div className="fca-form-row">
          <div className="fca-label">Show results to include:</div>
          <div className="fca-field flex items-center gap-4">
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeDisclosing}
                onChange={(e) => setIncludeDisclosing(e.target.checked)}
                style={{ accentColor: "var(--fca-purple)" }}
              />
              Disclosing Organisation
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeRelated}
                onChange={(e) => setIncludeRelated(e.target.checked)}
                style={{ accentColor: "var(--fca-purple)" }}
              />
              Related Organisation
            </label>
          </div>
          <div />
          <div />
        </div>

        <div className="fca-form-row">
          <div className="fca-label">Organisation Name</div>
          <div className="fca-field">
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="fca-input"
              placeholder="e.g. Barclays"
            />
          </div>
          <div className="fca-label">Organisation LEI</div>
          <div className="fca-field">
            <input
              type="text"
              value={orgLEI}
              onChange={(e) => setOrgLEI(e.target.value.toUpperCase())}
              className="fca-input"
              placeholder="e.g. 213800LBQA1Y9L22JB70"
              style={{ fontFamily: "monospace" }}
            />
          </div>
        </div>

        {/* ── Time Period ───────────────────────────────────── */}
        <div className="fca-form-section-header">Time Period</div>

        <DateRange
          label="Filing Date"
          from={filingDateFrom} to={filingDateTo}
          onFrom={setFilingDateFrom} onTo={setFilingDateTo}
        />
        <DateRange
          label="Publication Date"
          from={pubDateFrom} to={pubDateTo}
          onFrom={setPubDateFrom} onTo={setPubDateTo}
        />

        {/* ── Buttons ───────────────────────────────────────── */}
        <div className="flex gap-2 p-3 border-t" style={{ borderColor: "#d0d0d0" }}>
          <button type="submit" disabled={loading} className="fca-btn-primary">
            {loading ? "Searching…" : "Search"}
          </button>
          <button type="button" onClick={handleReset} className="fca-btn-secondary">
            Reset
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="text-sm p-3 mb-3" style={{ background: "#fce8e8", border: "1px solid #e8a0a0", color: "#5c0000" }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <p className="text-sm mb-2" style={{ color: "var(--fca-text)" }}>
            {results.length === 0
              ? "No results found."
              : <>
                  Showing <strong>{results.length}</strong> result{results.length !== 1 ? "s" : ""}
                  {total !== null && total > results.length && <> of <strong>{total.toLocaleString()}</strong> total</>}
                </>
            }
          </p>
          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="fca-table">
                <thead>
                  <tr>
                    <th>Headline</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Source</th>
                    <th>Date</th>
                    <th>Document</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td style={{ maxWidth: 280 }}>{r.title}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.company}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.filingType}</td>
                      <td>{r.source}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                      <td>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--fca-link)" }}
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {results === null && !loading && (
        <p className="text-sm italic" style={{ color: "#555" }}>
          Enter a company name, LEI, or document keywords above to search NSM filings.
        </p>
      )}
    </div>
  );
}
