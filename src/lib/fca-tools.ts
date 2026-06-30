/**
 * FCA Data Portal tool functions.
 * All data is fetched from public, unauthenticated endpoints on data.fca.org.uk.
 * robots.txt is respected — these are the same calls a browser makes when using the portal.
 */

const FCA_BASE = "https://data.fca.org.uk";
const FCA_API_BASE = "https://api.data.fca.org.uk";

// ─── NSM search cache ────────────────────────────────────────────────────────
// Caches successful NSM search results to avoid hitting Cloudflare rate limits
// on repeated queries. Keyed by a hash of the search parameters.
// Only caches results with total > 0 (blocked responses are never cached).
const NSM_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
interface NsmCacheEntry { data: { total: number; filings: NSMFiling[] }; ts: number }
const nsmCache = new Map<string, NsmCacheEntry>();

function nsmCacheKey(prefix: string, params: Record<string, unknown>): string {
  return `${prefix}:${JSON.stringify(params)}`;
}

function nsmCacheGet(key: string): { total: number; filings: NSMFiling[] } | null {
  const entry = nsmCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > NSM_CACHE_TTL) { nsmCache.delete(key); return null; }
  console.log("[fca-tools] nsm_cache_hit key=%s total=%d", key.slice(0, 60), entry.data.total);
  return entry.data;
}

function nsmCacheSet(key: string, data: { total: number; filings: NSMFiling[] }) {
  if (data.total === 0) return; // never cache blocked/empty results
  nsmCache.set(key, { data, ts: Date.now() });
  console.log("[fca-tools] nsm_cache_set key=%s total=%d", key.slice(0, 60), data.total);
}

/**
 * POST to the FCA NSM search API.
 * The endpoint is protected by Cloudflare Bot Management — when blocked it
 * returns a 200 with took<10ms and 0 results. Results are cached in nsmCache
 * to avoid repeated calls for the same query.
 */
async function fcaPost(url: string, body: unknown, attempt = 1): Promise<unknown> {
  const start = Date.now();

  // On Vercel: route through the edge proxy so outbound FCA requests come from
  // CDN edge node IPs (different pool from serverless IPs, not Cloudflare-blocked).
  // Locally: call the FCA API directly — no Deployment Protection to bypass.
  const vercelUrl = process.env.VERCEL_URL;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  let fetchUrl: string;
  let headers: Record<string, string>;

  if (vercelUrl) {
    const index = new URL(url).searchParams.get("index") ?? "fca-nsm-searchdata";
    fetchUrl = `https://${vercelUrl}/api/fca-proxy?index=${encodeURIComponent(index)}`;
    headers = {
      "Content-Type": "application/json",
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    };
    console.log("[fca-tools] fcaPost via=edge-proxy attempt=%d bypass=%s", attempt, bypassSecret ? "yes" : "no");
  } else {
    fetchUrl = url;
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: "https://data.fca.org.uk",
      Referer: "https://data.fca.org.uk/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
  }

  let res: Response;
  try {
    res = await fetch(fetchUrl, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    console.error("[fca-tools] fcaPost fetch_error url=%s error=%s", fetchUrl, (err as Error).message);
    return null;
  }
  if (!res.ok) {
    console.error("[fca-tools] fcaPost http_error url=%s status=%d elapsed=%dms", fetchUrl, res.status, Date.now() - start);
    return null;
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("[fca-tools] fcaPost json_parse_error url=%s body=%s", fetchUrl, text.slice(0, 200));
    return null;
  }
  const p = parsed as Record<string, unknown>;
  const took = p?.took as number | undefined;
  const totalValue = ((p?.hits as Record<string, unknown>)?.total as Record<string, unknown>)?.value;
  // took<10ms + value=0 is Cloudflare's soft-block fingerprint — real Elasticsearch always takes >10ms
  if (typeof took === "number" && took < 10 && totalValue === 0 && attempt < 3) {
    console.warn("[fca-tools] fcaPost soft_block took=%dms attempt=%d", took, attempt);
    await new Promise(r => setTimeout(r, 800));
    return fcaPost(url, body, attempt + 1);
  }
  console.log("[fca-tools] fcaPost ok elapsed=%dms took=%dms attempt=%d bodyPreview=%s",
    Date.now() - start, took ?? -1, attempt, text.slice(0, 200).replace(/\n/g, " "));
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

// For filing types where the API criterion name is `type_code` (not `type`),
// using codes is more reliable than matching on the display string.
// The "err:" prefix covers amended/corrected submissions.
const FILING_TYPE_CODES: Record<string, string[]> = {
  // Annual reports
  "annual report": ["acs", "err:acs"],
  "annual reports": ["acs", "err:acs"],
  "annual financial report": ["acs", "err:acs"],
  // Half-yearly / interim reports
  "half yearly": ["ir", "err:ir"],
  "half yearly report": ["ir", "err:ir"],
  "half year report": ["ir", "err:ir"],
  "interim report": ["ir", "err:ir"],
  "interim results": ["ir", "err:ir"],
  "half year": ["ir", "err:ir"],
  // Quarterly reports (Q1 and Q3 — the API does not distinguish between them at type_code level)
  "quarterly report": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "quarterly reports": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "1st quarter": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "first quarter": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "q1 report": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "3rd quarter": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "third quarter": ["qrf", "err:qrf", "qrt", "err:qrt"],
  "q3 report": ["qrf", "err:qrf", "qrt", "err:qrt"],
  // Periodic reports (all of the above combined)
  "periodic report": ["qrf", "err:qrf", "qrt", "err:qrt", "acs", "err:acs", "ir", "err:ir"],
  "periodic reports": ["qrf", "err:qrf", "qrt", "err:qrt", "acs", "err:acs", "ir", "err:ir"],
};

function buildTypeFilter(raw: string): { name: string; value: unknown } {
  const codes = FILING_TYPE_CODES[raw.toLowerCase()];
  if (codes) return { name: "type_code", value: codes };
  return { name: "type", value: FILING_TYPE_ALIASES[raw.toLowerCase()] ?? raw };
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
  const cacheKey = nsmCacheKey("company", params);
  const cached = nsmCacheGet(cacheKey);
  if (cached) return cached;

  const from = (params.page ?? 0) * 10;

  const criteria: unknown[] = [
    { name: "company_lei", value: [params.company, "", "disclose_org", "related_org"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push(buildTypeFilter(params.filing_type));
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 10,
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

  if (total === 0) console.warn("[fca-tools] searchNSMByCompany zero_results company=%s", params.company);
  else console.log("[fca-tools] searchNSMByCompany ok company=%s total=%d returned=%d", params.company, total, hits.length);
  const result = { total, filings: mapHitsToFilings(hits) };
  nsmCacheSet(cacheKey, result);
  return result;
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
  const cacheKey = nsmCacheKey("lei", params);
  const cached = nsmCacheGet(cacheKey);
  if (cached) return cached;

  const from = (params.page ?? 0) * 10;

  const criteria: unknown[] = [
    { name: "company_lei", value: ["", params.lei, "disclose_org", "related_org"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push(buildTypeFilter(params.filing_type));
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 10,
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

  if (total === 0) console.warn("[fca-tools] searchNSMByLEI zero_results lei=%s", params.lei);
  else console.log("[fca-tools] searchNSMByLEI ok lei=%s total=%d returned=%d", params.lei, total, hits.length);
  const result = { total, filings: mapHitsToFilings(hits) };
  nsmCacheSet(cacheKey, result);
  return result;
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
  const cacheKey = nsmCacheKey("content", params);
  const cached = nsmCacheGet(cacheKey);
  if (cached) return cached;

  const from = (params.page ?? 0) * 10;

  const criteria: unknown[] = [
    { name: "document_content", value: [params.keywords, params.matchMode ?? "any_word"] },
    { name: "latest_flag", value: "Y" },
  ];
  if (params.filing_type) {
    criteria.push(buildTypeFilter(params.filing_type));
  }
  if (params.source) {
    criteria.push({ name: "source", value: params.source });
  }

  const body = {
    from,
    size: 10,
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
  const result = { total, filings: mapHitsToFilings(hits) };
  nsmCacheSet(cacheKey, result);
  return result;
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

/**
 * Finds the earliest position in text that matches any word from the prompt.
 * Falls back to a full-phrase match first, then tries individual words so that
 * multi-word prompts like "director PDMR shareholding" still find a relevant anchor.
 * Stopwords are skipped so common words don't produce unhelpful anchors.
 */
const STOPWORDS = new Set(["a", "an", "the", "in", "on", "at", "to", "of", "for", "and", "or", "is", "it", "by", "be", "with", "from", "as", "this", "that", "are", "was", "were", "has", "have"]);

function findBestAnchor(fullTextLower: string, prompt: string): number {
  const promptLower = prompt.toLowerCase();
  // 1. Try exact phrase first
  const phraseIdx = fullTextLower.indexOf(promptLower);
  if (phraseIdx !== -1) return phraseIdx;
  // 2. Try each meaningful word, return earliest hit
  const words = promptLower.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  let best = -1;
  for (const word of words) {
    const idx = fullTextLower.indexOf(word);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function fetchPDFSummary(docUrl: string, extractionPrompt?: string): Promise<string> {
  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(docUrl, { headers: { "User-Agent": "FCA-Demo-Bot/1.0" } });
  } catch (err) {
    console.error("[fca-tools] fetchDoc fetch_error url=%s error=%s", docUrl, (err as Error).message);
    return `Could not fetch document at ${docUrl}: network error`;
  }
  if (!res.ok) {
    console.error("[fca-tools] fetchDoc http_error url=%s status=%d", docUrl, res.status);
    return `Could not fetch document at ${docUrl} (HTTP ${res.status})`;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html") || docUrl.toLowerCase().endsWith(".html") || docUrl.toLowerCase().endsWith(".htm");

  if (isHtml) {
    const html = await res.text();
    const fullText = extractTextFromHtml(html);
    const totalChars = fullText.length;
    const LIMIT = 50_000;
    console.log("[fca-tools] fetchDoc html url=%s totalChars=%d elapsed=%dms", docUrl, totalChars, Date.now() - start);

    if (extractionPrompt) {
      const idx = findBestAnchor(fullText.toLowerCase(), extractionPrompt);
      if (idx !== -1) {
        const s = Math.max(0, idx - 500);
        const excerpt = fullText.slice(s, Math.min(totalChars, s + LIMIT));
        return `[HTML document, ${totalChars.toLocaleString()} chars total — showing ${excerpt.length.toLocaleString()} chars near "${extractionPrompt}"]\n\n${excerpt}`;
      }
      console.warn("[fca-tools] fetchDoc html keyword_not_found url=%s prompt=%s", docUrl, extractionPrompt);
    }

    const excerpt = fullText.slice(0, LIMIT);
    return `[HTML document, ${totalChars.toLocaleString()} chars total — showing first ${excerpt.length.toLocaleString()} chars]\n\n${excerpt}`;
  }

  // PDF path
  const buffer = await res.arrayBuffer();
  console.log("[fca-tools] fetchDoc pdf downloaded url=%s sizeKB=%d elapsed=%dms", docUrl, Math.round(buffer.byteLength / 1024), Date.now() - start);

  try {
    // pdf-parse v2 exports a class — instantiate with the buffer then call getText()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse } = await import("pdf-parse") as any;
    const parser = new PDFParse({ data: Buffer.from(buffer) });
    const result = await parser.getText() as { text: string; total: number };
    const fullText = result.text;
    const totalChars = fullText.length;
    const LIMIT = 50_000;
    console.log("[fca-tools] fetchDoc pdf parsed url=%s pages=%d totalChars=%d elapsed=%dms", docUrl, result.total, totalChars, Date.now() - start);

    if (extractionPrompt) {
      const idx = findBestAnchor(fullText.toLowerCase(), extractionPrompt);
      if (idx === -1) {
        console.warn("[fca-tools] fetchDoc pdf keyword_not_found url=%s prompt=%s", docUrl, extractionPrompt);
      } else {
        const start2 = Math.max(0, idx - 500);
        const end = Math.min(totalChars, start2 + LIMIT);
        const excerpt = fullText.slice(start2, end);
        return `[PDF: ${result.total} pages, ${totalChars.toLocaleString()} chars total — showing ${excerpt.length.toLocaleString()} chars near "${extractionPrompt}"]\n\n${excerpt}`;
      }
    }

    const excerpt = fullText.slice(0, LIMIT);
    return `[PDF: ${result.total} pages, ${totalChars.toLocaleString()} chars total — showing first ${excerpt.length.toLocaleString()} chars]\n\n${excerpt}`;
  } catch (err) {
    console.error("[fca-tools] fetchDoc pdf parse_error url=%s error=%s", docUrl, (err as Error).message);
    return `Document text extraction failed. Direct link: ${docUrl}`;
  }
}

// ─── FIRDS ────────────────────────────────────────────────────────────────────

export interface FIRDSInstrument {
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

/**
 * Search FIRDS using the same POST search API as NSM.
 * The `keyword` field performs a full-text search across instrument names.
 * For an exact ISIN, pass it as `keyword` — the API will match on isin_sngl_noindx / isin_sngl_indx fields.
 */
// Standard filters always included in criteria-based FIRDS searches
const FIRDS_BASE_CRITERIA = [
  { name: "techattrbts_nvrpblshd", value: "false" },
  { name: "active_flag", value: "Y" },
];

export async function searchFIRDS(params: {
  isin?: string;
  instrument_id?: string;
  instrument_name?: string;
  issuer_lei?: string;
  classification?: string;
}): Promise<FIRDSInstrument[]> {
  const hasCriteria = !!(params.instrument_id || params.isin || params.issuer_lei || params.classification);
  const keyword = hasCriteria ? "" : (params.instrument_name ?? "");
  if (!keyword && !hasCriteria) return [];

  // Criteria-based search (instrument ID or ISIN) — uses criteriaObj, no keyword field
  // Keyword search (company/instrument name) — uses keyword field, criteriaObj: null
  let body: Record<string, unknown>;
  if (params.instrument_id) {
    body = {
      from: 0,
      size: 20,
      sort: "fininstrmgnlattrbts_id",
      sortorder: "asc",
      criteriaObj: {
        criteria: [
          { name: "fininstrmgnlattrbts_id", value: params.instrument_id },
          ...FIRDS_BASE_CRITERIA,
        ],
        dateCriteria: null,
      },
    };
  } else if (params.isin) {
    body = {
      from: 0,
      size: 20,
      sort: "fininstrmgnlattrbts_id",
      sortorder: "asc",
      keyword: null,
      criteriaObj: {
        criteria: [
          { name: "isin_bskt", value: params.isin },
          ...FIRDS_BASE_CRITERIA,
        ],
        dateCriteria: null,
      },
    };
  } else if (params.issuer_lei) {
    body = {
      from: 0,
      size: 20,
      sort: "fininstrmgnlattrbts_id",
      sortorder: "asc",
      keyword: null,
      criteriaObj: {
        criteria: [
          { name: "issr", value: params.issuer_lei },
          ...FIRDS_BASE_CRITERIA,
        ],
        dateCriteria: null,
      },
    };
  } else if (params.classification) {
    body = {
      from: 0,
      size: 20,
      sort: "fininstrmgnlattrbts_id",
      sortorder: "asc",
      keyword: null,
      criteriaObj: {
        criteria: [
          { name: "fininstrmgnlattrbts_clssfctntp", value: params.classification },
          ...FIRDS_BASE_CRITERIA,
        ],
        dateCriteria: null,
      },
    };
  } else {
    body = {
      from: 0,
      size: 20,
      sort: "fininstrmgnlattrbts_id",
      sortorder: "asc",
      keyword,
      criteriaObj: null,
    };
  }

  const firdsStart = Date.now();
  const data = await fcaPost(`${FCA_API_BASE}/search?index=fca-firds-viewdata`, body) as Record<string, unknown> | null;

  if (!data) {
    console.warn("[fca-tools] searchFIRDS no_data keyword=%s elapsed=%dms", keyword, Date.now() - firdsStart);
    return [];
  }

  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];

  if (total === 0) console.warn("[fca-tools] searchFIRDS zero_results keyword=%s elapsed=%dms", keyword, Date.now() - firdsStart);
  else console.log("[fca-tools] searchFIRDS ok keyword=%s total=%d returned=%d elapsed=%dms", keyword, total, hits.length, Date.now() - firdsStart);

  return hits.map((item: unknown) => {
    const h = item as Record<string, unknown>;
    const src = (h._source ?? {}) as Record<string, unknown>;
    const cfi = String(src.fininstrmgnlattrbts_clssfctntp ?? "");
    const isin = String(src.isin_sngl_noindx ?? src.isin_sngl_indx ?? "");
    const seqId = String(src.seq_id ?? "");
    return {
      isin,
      instrumentId: String(src.fininstrmgnlattrbts_id ?? ""),
      instrumentName: String(src.fininstrmgnlattrbts_fullnm ?? ""),
      shortName: String(src.fininstrmgnlattrbts_shrtnm ?? ""),
      cfiCode: cfi,
      mic: String(src.tradgvnrltdattrbts_id ?? ""),
      issuerLei: String(src.issr ?? ""),
      currency: String(src.fininstrmgnlattrbts_ntnlccy ?? ""),
      firstTradeDate: formatDate(String(src.tradgvnrltdattrbts_frsttraddt ?? "")),
      reportable: isReportable(cfi),
      detailUrl: seqId ? `${FCA_BASE}/#/moreinfo/${seqId}` : "",
    };
  });
}

function isReportable(cfiCode: string): boolean {
  // Under UK MiFIR, instruments admitted to or traded on UK trading venues are reportable.
  // CFI codes starting with E (equity), D (debt), R (entitlements) are generally reportable.
  const c = cfiCode.toUpperCase();
  return c.startsWith("E") || c.startsWith("D") || c.startsWith("R");
}

// ─── FITRS ────────────────────────────────────────────────────────────────────

export interface FITRSFile {
  fileName: string;
  fileType: "Full" | "Delta" | string;
  instrumentType: string;
  publicationDate: string;
  downloadLink: string;
  lastRefreshed: string;
}

/**
 * Search the FITRS file index.
 * FITRS publishes transparency calculation results as downloadable ZIP files
 * (Full files weekly, Delta files daily). This function queries the file index
 * by date range and optional file type filter.
 *
 * Date format for the API: DD/MM/YYYY
 */
export async function searchFITRS(params: {
  date_from?: string;  // YYYY-MM-DD (will be converted to DD/MM/YYYY for API)
  date_to?: string;    // YYYY-MM-DD (will be converted to DD/MM/YYYY for API)
  file_type?: "Full" | "Delta";
  keyword?: string;
}): Promise<{ total: number; files: FITRSFile[] }> {
  const fitrsStart = Date.now();

  // API requires DD/MM/YYYY format for date criteria
  function toApiDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 30);

  const dateFrom = toApiDate(params.date_from ?? defaultFrom.toISOString().slice(0, 10));
  const dateTo = toApiDate(params.date_to ?? now.toISOString().slice(0, 10));

  const criteria: unknown[] | null = params.file_type
    ? [{ name: "file_type", value: params.file_type }]
    : null;

  const body: Record<string, unknown> = {
    from: 0,
    size: 20,
    sort: "publication_date",
    sortorder: "desc",
    keyword: params.keyword ?? null,
    criteriaObj: {
      criteria,
      dateCriteria: [
        { name: "publication_date", value: { from: dateFrom, to: dateTo } },
      ],
    },
  };

  const data = await fcaPost(`${FCA_API_BASE}/search?index=fca-fitrs-downloadfiles`, body) as Record<string, unknown> | null;

  if (!data) {
    console.warn("[fca-tools] searchFITRS no_data dateFrom=%s dateTo=%s elapsed=%dms", dateFrom, dateTo, Date.now() - fitrsStart);
    return { total: 0, files: [] };
  }

  const hitsObj = data.hits as Record<string, unknown>;
  const total = (hitsObj?.total as Record<string, unknown>)?.value as number ?? 0;
  const hits: unknown[] = hitsObj?.hits as unknown[] ?? [];

  if (total === 0) console.warn("[fca-tools] searchFITRS zero_results dateFrom=%s dateTo=%s elapsed=%dms", dateFrom, dateTo, Date.now() - fitrsStart);
  else console.log("[fca-tools] searchFITRS ok total=%d returned=%d elapsed=%dms", total, hits.length, Date.now() - fitrsStart);

  const files: FITRSFile[] = hits.map((item: unknown) => {
    const h = item as Record<string, unknown>;
    const src = (h._source ?? {}) as Record<string, unknown>;
    return {
      fileName: String(src.file_name ?? ""),
      fileType: String(src.file_type ?? ""),
      instrumentType: String(src.instrument_type ?? ""),
      publicationDate: String(src.publication_date ?? ""),
      downloadLink: String(src.download_link ?? ""),
      lastRefreshed: String(src.last_refreshed ?? ""),
    };
  });

  return { total, files };
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

