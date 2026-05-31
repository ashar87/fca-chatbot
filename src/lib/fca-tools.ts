/**
 * FCA Data Portal tool functions.
 * All data is fetched from public, unauthenticated endpoints on data.fca.org.uk.
 * robots.txt is respected — these are the same calls a browser makes when using the portal.
 */

const FCA_BASE = "https://data.fca.org.uk";
const FCA_API_BASE = "https://api.data.fca.org.uk";

/**
 * The NSM search endpoint (fca-nsm-searchdata) is protected by Cloudflare Bot Management
 * which checks the TLS/JA3 fingerprint. Node.js has a distinct fingerprint that gets blocked,
 * but curl passes. This helper spawns curl for POST requests to the FCA API.
 */
async function fcaPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: "https://data.fca.org.uk",
      Referer: "https://data.fca.org.uk/",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
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
  if (!data) return { total: 0, filings: [] };
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];
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
  if (!data) return { total: 0, filings: [] };
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];
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
  if (!data) return { total: 0, filings: [] };
  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];
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

export async function fetchPDFSummary(pdfUrl: string): Promise<string> {
  // Fetch the PDF and extract text server-side
  const res = await fetch(pdfUrl, {
    headers: { "User-Agent": "FCA-Demo-Bot/1.0" },
  });
  if (!res.ok) return `Could not fetch PDF at ${pdfUrl}`;
  const buffer = await res.arrayBuffer();
  // Dynamically import pdf-parse to avoid edge runtime issues
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (await import("pdf-parse") as any).default ?? (await import("pdf-parse") as any);
    const result = await pdfParse(Buffer.from(buffer));
    // Return first ~3000 chars
    return result.text.slice(0, 3000);
  } catch {
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

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
    next: { revalidate: 3600 * 24 },
  });

  if (!res.ok) return searchFIRDSFallback(params);

  const data = await res.json();
  const items: unknown[] = data?.content ?? data?.items ?? (Array.isArray(data) ? data : []);
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
  const url = `${FCA_BASE}/api/proxy/fitrs/bonds/${encodeURIComponent(isin)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "FCA-Demo-Bot/1.0" },
    next: { revalidate: 3600 * 24 * 7 },
  });

  if (!res.ok) return searchFITRSFallback(isin);

  const data = await res.json();
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r) return null;

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
    cachedPositions = await fetchShortSellingCSV();
    cacheTime = Date.now();
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
