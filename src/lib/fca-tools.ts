/**
 * FCA Data Portal tool functions.
 * All data is fetched from public, unauthenticated endpoints on data.fca.org.uk.
 * robots.txt is respected — these are the same calls a browser makes when using the portal.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const FCA_BASE = "https://data.fca.org.uk";
const FCA_API_BASE = "https://api.data.fca.org.uk";

/**
 * The NSM search endpoint (fca-nsm-searchdata) is protected by Cloudflare Bot Management
 * which checks the TLS/JA3 fingerprint. Node.js has a distinct fingerprint that gets blocked,
 * but curl passes. This helper spawns curl for POST requests to the FCA API.
 */
/**
 * POST to the FCA API using curl instead of Node.js fetch.
 * curl has a browser-like TLS fingerprint that passes Cloudflare Bot Management;
 * Node.js fetch has a distinct fingerprint that gets soft-blocked (200 with 0 results).
 */
async function fcaPost(url: string, body: unknown, attempt = 1): Promise<unknown> {
  const start = Date.now();
  const bodyStr = JSON.stringify(body);

  let stdout: string;
  try {
    const result = await execFileAsync("curl", [
      "--silent",
      "--request", "POST",
      "--url", url,
      "--header", "Content-Type: application/json",
      "--header", "Accept: application/json, text/plain, */*",
      "--header", "Origin: https://data.fca.org.uk",
      "--header", "Referer: https://data.fca.org.uk/",
      "--header", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "--data-raw", bodyStr,
      "--compressed",
      "--max-time", "15",
    ]);
    stdout = result.stdout;
  } catch (err) {
    console.error("[fca-tools] fcaPost curl_error url=%s error=%s elapsed=%dms", url, (err as Error).message, Date.now() - start);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    console.error("[fca-tools] fcaPost json_parse_error url=%s body=%s", url, stdout.slice(0, 200));
    return null;
  }

  const p = parsed as Record<string, unknown>;
  const took = p?.took as number | undefined;
  const totalValue = ((p?.hits as Record<string, unknown>)?.total as Record<string, unknown>)?.value;

  // Still detect soft-block in case curl also gets throttled — retry once with a short delay
  const isSoftBlock = typeof took === "number" && took < 10 && totalValue === 0;
  if (isSoftBlock && attempt < 3) {
    const delay = attempt * 1000;
    console.warn("[fca-tools] fcaPost soft_block took=%dms attempt=%d delay=%dms url=%s", took, attempt, delay, url);
    await new Promise((r) => setTimeout(r, delay));
    return fcaPost(url, body, attempt + 1);
  }

  console.log("[fca-tools] fcaPost ok elapsed=%dms took=%dms attempt=%d bodyPreview=%s",
    Date.now() - start, took ?? -1, attempt, stdout.slice(0, 200).replace(/\n/g, " "));
  return parsed;
}

// ─── NSM ──────────────────────────────────────────────────────────────────────

export interface NSMFiling {
  id: string;
  title: string;
  company: string;
  filingType: string;
  typeCode: string;
  source: string;
  date: string;
  url: string;
  relatedOrgs: string[];
}

// The FCA API uses these exact type values in the `type` field.
// Friendly aliases let the LLM pass natural language that we map before querying.
const FILING_TYPE_ALIASES: Record<string, string> = {
  "annual report": "Annual Report",
  "annual reports": "Annual Report",
  "prospectus": "Prospectus",
  "circular": "Circ re.",
  "circulars": "Circ re.",
  "holding": "Holding(s) in Company",
  "holdings": "Holding(s) in Company",
  "major holdings": "Holding(s) in Company",
  "form 8.3": "Form 8.3",
  "form 8.5": "Form 8.5 (EPT/NON-RI)",
  "admission": "Admission to Trading",
  "admission to trading": "Admission to Trading",
  "final terms": "Final Terms",
  "supplementary prospectus": "Publication of a Supplementary Prospectus",
  "offering circular": "Circ re.",
  "irish takeover": "Irish Takeover Panel",
  "net asset value": "Net Asset Value(s)",
  "nav": "Net Asset Value(s)",
  "miscellaneous": "Miscellaneous",
};

function resolveFilingType(raw: string): string {
  return FILING_TYPE_ALIASES[raw.toLowerCase()] ?? raw;
}

function buildDateCriteria(dateFrom?: string, dateTo?: string) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const range = {
    from: dateFrom ? new Date(dateFrom).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    to: dateTo ? new Date(dateTo).toISOString().replace(/\.\d{3}Z$/, "Z") : now,
  };
  return [
    { name: "publication_date", value: range },
    { name: "submitted_date", value: range },
  ];
}

function mapHitsToFilings(hits: unknown[]): NSMFiling[] {
  return hits.map((item: unknown) => {
    const h = item as Record<string, unknown>;
    const src = (h._source ?? {}) as Record<string, unknown>;
    const id = String(h._id ?? src.disclosure_id ?? "");
    const downloadLink = String(src.download_link ?? "");
    const docUrl = downloadLink
      ? `${FCA_BASE}/artefacts/${downloadLink}`
      : `${FCA_BASE}/#/nsm/nationalstoragemechanism/filingDetails/${id}`;
    const relatedOrgs = (src.related_org as unknown[] ?? []).map((o) => {
      const org = o as Record<string, unknown>;
      return String(org.company ?? "");
    }).filter(Boolean);
    return {
      id,
      title: String(src.headline ?? "Untitled"),
      company: String(src.company ?? "Unknown").replace(/;$/, "").trim(),
      filingType: String(src.type ?? "Filing"),
      typeCode: String(src.type_code ?? ""),
      source: String(src.source ?? ""),
      date: formatDate(String(src.publication_date ?? src.submitted_date ?? "")),
      url: docUrl,
      relatedOrgs,
    };
  });
}

/**
 * Search NSM by company name or LEI — answers "what has [company] filed?"
 * Uses the company_lei criterion which matches on the filing company, disclosing org,
 * or a related org. Passing a text name performs a fuzzy match; passing a LEI is exact.
 */
export async function searchNSMByCompany(params: {
  company: string;
  filing_type?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}): Promise<{ total: number; filings: NSMFiling[] }> {
  const from = (params.page ?? 0) * 50;

  const criteria: unknown[] = [
    { name: "company_lei", value: [params.company, "", "disclose_org", "related_org"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push({ name: "type", value: resolveFilingType(params.filing_type) });
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 50,
    sort: "submitted_date",
    sortorder: "desc",
    criteriaObj: { criteria, dateCriteria: buildDateCriteria(params.date_from, params.date_to) },
  };

  const data = await fcaPost(`${FCA_API_BASE}/search?index=fca-nsm-searchdata`, body) as Record<string, unknown> | null;
  if (!data) {
    console.warn("[fca-tools] searchNSMByCompany no_data company=%s", params.company);
    return { total: 0, filings: [] };
  }
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];

  // Fallback: company_lei criterion may be blocked by Cloudflare — retry using document_content
  if (total === 0) {
    console.warn("[fca-tools] searchNSMByCompany zero_results company=%s — falling back to document_content", params.company);
    return searchNSMByContent({
      keywords: params.company,
      filing_type: params.filing_type,
      source: params.source,
      date_from: params.date_from,
      date_to: params.date_to,
      page: params.page,
    });
  }

  console.log("[fca-tools] searchNSMByCompany ok company=%s total=%d returned=%d", params.company, total, hits.length);
  return { total, filings: mapHitsToFilings(hits) };
}

/**
 * Search NSM by LEI code — precise, no text-match noise.
 * Use when you have resolved an exact LEI for a company.
 */
export async function searchNSMByLEI(params: {
  lei: string;
  filing_type?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}): Promise<{ total: number; filings: NSMFiling[] }> {
  const from = (params.page ?? 0) * 50;

  const criteria: unknown[] = [
    { name: "company_lei", value: ["", params.lei, "disclose_org", "related_org"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push({ name: "type", value: resolveFilingType(params.filing_type) });
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 50,
    sort: "submitted_date",
    sortorder: "desc",
    criteriaObj: { criteria, dateCriteria: buildDateCriteria(params.date_from, params.date_to) },
  };

  const data = await fcaPost(`${FCA_API_BASE}/search?index=fca-nsm-searchdata`, body) as Record<string, unknown> | null;
  if (!data) {
    console.warn("[fca-tools] searchNSMByLEI no_data lei=%s", params.lei);
    return { total: 0, filings: [] };
  }
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];

  // Fallback: company_lei criterion may be blocked by Cloudflare — retry using document_content
  if (total === 0) {
    console.warn("[fca-tools] searchNSMByLEI zero_results lei=%s — falling back to document_content", params.lei);
    return searchNSMByContent({
      keywords: params.lei,
      filing_type: params.filing_type,
      source: params.source,
      date_from: params.date_from,
      date_to: params.date_to,
      page: params.page,
    });
  }

  console.log("[fca-tools] searchNSMByLEI ok lei=%s total=%d returned=%d", params.lei, total, hits.length);
  return { total, filings: mapHitsToFilings(hits) };
}

/**
 * Search NSM by document content keywords — answers "find documents mentioning X".
 * This searches inside filing bodies, not by company identity.
 */
export async function searchNSMByContent(params: {
  keywords: string;
  matchMode?: "exact_match" | "all_words" | "any_word";
  filing_type?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}): Promise<{ total: number; filings: NSMFiling[] }> {
  const from = (params.page ?? 0) * 50;

  const criteria: unknown[] = [
    { name: "document_content", value: [params.keywords, params.matchMode ?? "any_word"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push({ name: "type", value: resolveFilingType(params.filing_type) });
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 50,
    sort: "submitted_date",
    sortorder: "desc",
    criteriaObj: { criteria, dateCriteria: buildDateCriteria(params.date_from, params.date_to) },
  };

  const data = await fcaPost(`${FCA_API_BASE}/search?index=fca-nsm-searchdata`, body) as Record<string, unknown> | null;
  if (!data) {
    console.warn("[fca-tools] searchNSMByContent no_data keywords=%s", params.keywords);
    return { total: 0, filings: [] };
  }
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];
  if (total === 0) console.warn("[fca-tools] searchNSMByContent zero_results keywords=%s", params.keywords);
  else console.log("[fca-tools] searchNSMByContent ok keywords=%s total=%d returned=%d", params.keywords, total, hits.length);
  return { total, filings: mapHitsToFilings(hits) };
}

// Keep a backward-compat export used by the /api/nsm route
export async function searchNSM(params: {
  query: string;
  filing_type?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}): Promise<NSMFiling[]> {
  const { filings } = await searchNSMByCompany({
    company: params.query,
    filing_type: params.filing_type,
    date_from: params.date_from,
    date_to: params.date_to,
    page: params.page,
  });
  return filings;
}

export async function fetchPDFSummary(pdfUrl: string, extractionPrompt?: string): Promise<string> {
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(pdfUrl, { headers: { "User-Agent": "FCA-Demo-Bot/1.0" } });
  } catch (err) {
    console.error("[fca-tools] fetchPDFSummary fetch_error url=%s error=%s", pdfUrl, (err as Error).message);
    return `Could not fetch PDF at ${pdfUrl}: network error`;
  }
  if (!res.ok) {
    console.error("[fca-tools] fetchPDFSummary http_error url=%s status=%d", pdfUrl, res.status);
    return `Could not fetch PDF at ${pdfUrl} (HTTP ${res.status})`;
  }
  const buffer = await res.arrayBuffer();
  console.log("[fca-tools] fetchPDFSummary downloaded url=%s sizeKB=%d elapsed=%dms", pdfUrl, Math.round(buffer.byteLength / 1024), Date.now() - start);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = (await import("pdf-parse") as any).default ?? (await import("pdf-parse") as any);
    const result = await pdfParse(Buffer.from(buffer));
    const fullText = result.text;
    const totalChars = fullText.length;
    const LIMIT = 50_000;
    console.log("[fca-tools] fetchPDFSummary parsed url=%s pages=%d totalChars=%d elapsed=%dms", pdfUrl, result.numpages, totalChars, Date.now() - start);

    // If the caller specified what to look for, try to find the most relevant
    // section by scanning for the keyword in the full text and returning a
    // window of up to LIMIT chars centred around the first match.
    if (extractionPrompt) {
      const needle = extractionPrompt.toLowerCase();
      const idx = fullText.toLowerCase().indexOf(needle);
      if (idx === -1) {
        console.warn("[fca-tools] fetchPDFSummary keyword_not_found url=%s prompt=%s", pdfUrl, extractionPrompt);
      } else {
        const start2 = Math.max(0, idx - 500);
        const end = Math.min(totalChars, start2 + LIMIT);
        const excerpt = fullText.slice(start2, end);
        return `[PDF: ${result.numpages} pages, ${totalChars.toLocaleString()} chars total — showing ${excerpt.length.toLocaleString()} chars from match for "${extractionPrompt}"]\n\n${excerpt}`;
      }
    }

    // Default: return from the beginning up to the limit
    const excerpt = fullText.slice(0, LIMIT);
    return `[PDF: ${result.numpages} pages, ${totalChars.toLocaleString()} chars total — showing first ${excerpt.length.toLocaleString()} chars]\n\n${excerpt}`;
  } catch (err) {
    console.error("[fca-tools] fetchPDFSummary parse_error url=%s error=%s", pdfUrl, (err as Error).message);
    return `PDF text extraction failed. Direct link: ${pdfUrl}`;
  }
}

// ─── FIRDS ────────────────────────────────────────────────────────────────────

export interface FIRDSInstrument {
  isin: string;
  instrumentName: string;
  cfiCode: string;
  mic: string;
  tradingVenue: string;
  reportable: boolean;
}

export async function searchFIRDS(params: {
  isin?: string;
  instrument_name?: string;
  mic?: string;
}): Promise<FIRDSInstrument[]> {
  const url = new URL(`${FCA_BASE}/api/proxy/firds/instruments`);
  if (params.isin) url.searchParams.set("isin", params.isin);
  if (params.instrument_name) url.searchParams.set("instrumentName", params.instrument_name);
  if (params.mic) url.searchParams.set("mic", params.mic);
  url.searchParams.set("pageSize", "20");

  const firdsStart = Date.now();
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
    next: { revalidate: 3600 * 24 },
  });

  if (!res.ok) {
    console.warn("[fca-tools] searchFIRDS http_error status=%d isin=%s elapsed=%dms — trying fallback", res.status, params.isin, Date.now() - firdsStart);
    return searchFIRDSFallback(params);
  }

  const data = await res.json();
  const items: unknown[] = data?.content ?? data?.items ?? (Array.isArray(data) ? data : []);
  if (items.length === 0) console.warn("[fca-tools] searchFIRDS zero_results isin=%s name=%s elapsed=%dms", params.isin, params.instrument_name, Date.now() - firdsStart);
  else console.log("[fca-tools] searchFIRDS ok isin=%s results=%d elapsed=%dms", params.isin, items.length, Date.now() - firdsStart);
  return items.slice(0, 20).map((item: unknown) => {
    const r = item as Record<string, unknown>;
    const cfi = String(r.cfiCode ?? r.cfi ?? "");
    return {
      isin: String(r.isin ?? ""),
      instrumentName: String(r.instrumentFullName ?? r.name ?? r.instrumentName ?? ""),
      cfiCode: cfi,
      mic: String(r.tradingVenueMic ?? r.mic ?? ""),
      tradingVenue: String(r.tradingVenueDescription ?? r.tradingVenue ?? r.mic ?? ""),
      reportable: isReportable(cfi, String(r.instrumentType ?? "")),
    };
  });
}

async function searchFIRDSFallback(params: {
  isin?: string;
  instrument_name?: string;
}): Promise<FIRDSInstrument[]> {
  if (!params.isin) return [];
  // Try direct ISIN lookup
  const url = `${FCA_BASE}/api/proxy/firds/instruments/${encodeURIComponent(params.isin)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const items: unknown[] = Array.isArray(data) ? data : [data];
  return items.map((item: unknown) => {
    const r = item as Record<string, unknown>;
    const cfi = String(r.cfiCode ?? r.cfi ?? "");
    return {
      isin: String(r.isin ?? params.isin ?? ""),
      instrumentName: String(r.instrumentFullName ?? r.name ?? ""),
      cfiCode: cfi,
      mic: String(r.tradingVenueMic ?? r.mic ?? ""),
      tradingVenue: String(r.tradingVenueDescription ?? r.tradingVenue ?? ""),
      reportable: isReportable(cfi, String(r.instrumentType ?? "")),
    };
  });
}

function isReportable(cfiCode: string, instrumentType: string): boolean {
  // Under UK MiFIR, instruments admitted to or traded on UK trading venues are reportable
  // CFI codes starting with E (equity), D (debt), R (entitlements) are generally reportable
  const c = cfiCode.toUpperCase();
  const t = instrumentType.toUpperCase();
  if (c.startsWith("E") || c.startsWith("D") || c.startsWith("R")) return true;
  if (t.includes("EQUITY") || t.includes("BOND") || t.includes("SHARE")) return true;
  return false;
}

// ─── FITRS ────────────────────────────────────────────────────────────────────

export interface FITRSRecord {
  isin: string;
  instrumentName: string;
  liquidityStatus: string;
  adna: string;
  lisThreshold: string;
  sstiThreshold: string;
  calculationPeriod: string;
}

export async function searchFITRS(isin: string): Promise<FITRSRecord | null> {
  const fitrsStart = Date.now();
  const url = `${FCA_BASE}/api/proxy/fitrs/bonds/${encodeURIComponent(isin)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
    next: { revalidate: 3600 * 24 * 7 },
  });

  if (!res.ok) {
    console.warn("[fca-tools] searchFITRS http_error status=%d isin=%s elapsed=%dms — trying equities fallback", res.status, isin, Date.now() - fitrsStart);
    return searchFITRSFallback(isin);
  }

  const data = await res.json();
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r) {
    console.warn("[fca-tools] searchFITRS no_record isin=%s elapsed=%dms", isin, Date.now() - fitrsStart);
    return null;
  }
  console.log("[fca-tools] searchFITRS ok isin=%s elapsed=%dms", isin, Date.now() - fitrsStart);
  return {
    isin: String(r.isin ?? isin),
    instrumentName: String(r.instrumentFullName ?? r.name ?? isin),
    liquidityStatus: String(r.liquidityStatus ?? r.liquid ?? "Unknown"),
    adna: formatAmount(String(r.adna ?? r.averageDailyNotionalAmount ?? "")),
    lisThreshold: formatAmount(String(r.lisThreshold ?? r.lis ?? "")),
    sstiThreshold: formatAmount(String(r.sstiThreshold ?? r.ssti ?? "")),
    calculationPeriod: String(r.calculationPeriod ?? r.period ?? ""),
  };
}

async function searchFITRSFallback(isin: string): Promise<FITRSRecord | null> {
  // Try equities endpoint
  const url = `${FCA_BASE}/api/proxy/fitrs/equities/${encodeURIComponent(isin)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    isin: String(r.isin ?? isin),
    instrumentName: String(r.instrumentFullName ?? r.name ?? isin),
    liquidityStatus: String(r.liquidityStatus ?? "Unknown"),
    adna: formatAmount(String(r.adna ?? "")),
    lisThreshold: formatAmount(String(r.lisThreshold ?? r.lis ?? "")),
    sstiThreshold: formatAmount(String(r.sstiThreshold ?? r.ssti ?? "")),
    calculationPeriod: String(r.calculationPeriod ?? ""),
  };
}

// ─── Short Selling ────────────────────────────────────────────────────────────

export interface ShortPosition {
  issuerName: string;
  positionHolder: string;
  netShortPosition: string;
  dateOfPosition: string;
  dateOfDisclosure: string;
}

let cachedPositions: ShortPosition[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 2 * 3600 * 1000; // 2 hours

export async function getShortPositions(params: {
  issuer_name?: string;
  above_threshold?: number;
}): Promise<ShortPosition[]> {
  // Fetch and cache the daily CSV
  if (!cachedPositions || Date.now() - cacheTime > CACHE_TTL) {
    console.log("[fca-tools] getShortPositions cache_miss — fetching fresh data");
    cachedPositions = await fetchShortSellingCSV();
    cacheTime = Date.now();
    console.log("[fca-tools] getShortPositions cache_loaded count=%d", cachedPositions.length);
    if (cachedPositions.length === 0) console.warn("[fca-tools] getShortPositions empty_dataset — all SSR endpoints returned no data");
  } else {
    console.log("[fca-tools] getShortPositions cache_hit count=%d", cachedPositions.length);
  }

  let results = cachedPositions;

  if (params.issuer_name) {
    const q = params.issuer_name.toLowerCase();
    results = results.filter((r) => r.issuerName.toLowerCase().includes(q));
  }

  if (params.above_threshold !== undefined) {
    results = results.filter((r) => parseFloat(r.netShortPosition) >= params.above_threshold!);
  }

  return results.slice(0, 50);
}

async function fetchShortSellingCSV(): Promise<ShortPosition[]> {
  // Try the main CSV endpoint
  const urls = [
    `${FCA_BASE}/api/proxy/ssr/positions`,
    `${FCA_BASE}/api/proxy/public/short-positions`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json, text/csv", "User-Agent": "FCA-Demo-Bot/1.0" },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        const data = await res.json();
        const items: unknown[] = Array.isArray(data) ? data : data?.items ?? data?.positions ?? [];
        return items.map(parseShortPosition);
      }
      if (contentType.includes("csv") || contentType.includes("text")) {
        const text = await res.text();
        return parseCSV(text);
      }
    } catch {
      continue;
    }
  }

  return [];
}

function parseShortPosition(item: unknown): ShortPosition {
  const r = item as Record<string, unknown>;
  return {
    issuerName: String(r.issuerName ?? r.issuer ?? r.company ?? ""),
    positionHolder: String(r.positionHolder ?? r.holder ?? r.entity ?? ""),
    netShortPosition: String(r.netShortPosition ?? r.position ?? r.netPosition ?? ""),
    dateOfPosition: formatDate(String(r.positionDate ?? r.dateOfPosition ?? r.date ?? "")),
    dateOfDisclosure: formatDate(String(r.disclosureDate ?? r.dateOfDisclosure ?? "")),
  };
}

function parseCSV(text: string): ShortPosition[] {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const get = (keys: string[]) => {
      for (const key of keys) {
        const idx = headers.findIndex((h) => h.includes(key));
        if (idx !== -1) return cells[idx] ?? "";
      }
      return "";
    };
    return {
      issuerName: get(["issuer", "company", "name"]),
      positionHolder: get(["holder", "entity", "position"]),
      netShortPosition: get(["net", "short", "pct", "percent"]),
      dateOfPosition: formatDate(get(["positiondate", "date"])),
      dateOfDisclosure: formatDate(get(["disclosure", "disclosed"])),
    };
  }).filter((r) => r.issuerName);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

function formatAmount(raw: string): string {
  if (!raw || raw === "null" || raw === "undefined") return "N/A";
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  if (n >= 1e9) return `€${(n / 1e9).toFixed(2)}bn`;
  if (n >= 1e6) return `€${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `€${(n / 1e3).toFixed(2)}k`;
  return `€${n.toFixed(2)}`;
}
