# FCA Data Portal — Chatbot Demo

A visual clone of [data.fca.org.uk](https://data.fca.org.uk) with an embedded AI chatbot that answers questions using live FCA public data. Built as a stakeholder demo; not a production deployment.

> **Keeping this file current:** Update CLAUDE.md whenever you add a new API endpoint, change a search function, add a new tool to Gemini, or discover a new FCA API behaviour. The sections most likely to go stale are: [AI Tools](#ai-tools-gemini-function-declarations), [FCA API Details](#fca-api-details), and [Key Design Decisions](#key-design-decisions).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI Model | Gemini 2.5 Flash (`gemini-2.5-flash`, thinking disabled) via `@google/genai` v2.7.0 |
| PDF extraction | `pdf-parse` |
| ZIP extraction | `fflate` |
| Markdown rendering | `react-markdown` |
| Deployment target | Vercel |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                     # Root page — two-column layout, section state
│   ├── layout.tsx                   # HTML shell, global font/metadata
│   ├── globals.css                  # CSS variables, FCA form/table/sidebar classes
│   └── api/
│       ├── chat/route.ts            # AI chat endpoint (POST, streaming SSE)
│       ├── fca-proxy/route.ts       # Edge-runtime proxy for NSM (bypasses Cloudflare)
│       ├── nsm/route.ts             # NSM search REST endpoint (GET)
│       ├── firds/route.ts           # FIRDS search REST endpoint (GET)
│       ├── fitrs/route.ts           # FITRS file index search endpoint (GET)
│       ├── fitrs-file/route.ts      # FITRS ZIP download + XML parse endpoint (GET)
│       └── short-selling/route.ts   # Short selling REST endpoint (GET)
├── components/
│   ├── ChatWidget.tsx               # Floating chat panel, SSE streaming, starter prompts
│   ├── Header.tsx                   # White header with FCA logo
│   ├── NavBar.tsx                   # Purple full-width nav bar
│   ├── Sidebar.tsx                  # Left sidebar — accordion sections, register links
│   ├── Footer.tsx                   # Dark footer
│   ├── NavTabs.tsx                  # Exports PortalSection type (no rendered component)
│   ├── NSMSearchPage.tsx            # NSM search form matching real portal layout
│   ├── FIRDSSearchPage.tsx          # FIRDS instrument search page
│   ├── FITRSSearchPage.tsx          # FITRS file browser with inline ZIP/XML extraction
│   └── ShortSellingPage.tsx         # Short selling register page
└── lib/
    └── fca-tools.ts                 # All FCA API calls + data models
```

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│ [WHITE HEADER — FCA logo]                           │
├─────────────────────────────────────────────────────┤
│ [PURPLE NAV BAR — Homepage | Print]                 │
├───────────────────┬─────────────────────────────────┤
│ SIDEBAR           │ MAIN CONTENT                    │
│ • National        │ (search form / results)         │
│   Storage Mech.   │                                 │
│   - NSM Search    │                                 │
│   - About NSM     │                                 │
│ • List of Regs    │                                 │
│   - FIRDS         │                                 │
│   - FITRS         │                                 │
│   - Short Selling │                                 │
├───────────────────┴─────────────────────────────────┤
│ [DARK FOOTER — copyright | back to top | links]     │
└─────────────────────────────────────────────────────┘
```

## Navigation Type

`PortalSection` (in `NavTabs.tsx`):
```ts
type PortalSection = "nsm-search" | "nsm-about" | "firds" | "fitrs" | "short-selling";
```

## CSS Design System

| Class | Purpose |
|---|---|
| `.fca-form` | Grey (#ebebeb) form container, no border-radius |
| `.fca-form-row` | 4-column grid: label / field / label / field |
| `.fca-form-row-single` | 2-column grid: label / field |
| `.fca-form-section-header` | Purple bold section title within a form |
| `.fca-label` | Bold form label |
| `.fca-field` | Field cell padding |
| `.fca-input` | White input, grey border, no border-radius, yellow focus ring |
| `.fca-select` | Matching select element |
| `.fca-btn-primary` | Purple button, no border-radius |
| `.fca-btn-secondary` | Grey secondary button |
| `.fca-table` | Results table with purple header, alternating rows |
| `.sidebar-section-header` | Purple sidebar section header |
| `.sidebar-item` | Grey sub-item (for NSM sub-pages) |
| `.sidebar-link` | Blue-link register items |
| `.content-panel` | Bordered white content area |

## Colour Palette

| Variable | Value | Usage |
|---|---|---|
| `--fca-purple` | `#701b45` | Primary — headers, buttons, sidebar |
| `--fca-purple-dark` | `#4d1230` | Hover state |
| `--fca-text` | `#0b0c0c` | Body text |
| `--fca-link` | `#1a6ca8` | Sidebar register links |
| `--fca-border` | `#b1b4b6` | Input borders |
| `--fca-form-bg` | `#ebebeb` | Form background |
| `--fca-footer-bg` | `#1a1a1a` | Footer background |

---

## Architecture

### Data Flow

```
User (ChatWidget)
    │  POST /api/chat  { messages[] }
    ▼
chat/route.ts
    │  Gemini Flash (agentic loop, up to 5 turns)
    │  ├── tool call → executeTool()
    │  │       └── fca-tools.ts functions
    │  │               └── POST to api.data.fca.org.uk (via edge proxy on Vercel)
    │  └── final text → SSE stream back to client
    ▼
ChatWidget (renders markdown, streams word-by-word)
```

The chat route runs an **agentic loop** (max 5 turns): Gemini can call multiple tools in sequence before producing a final answer.

### Streaming

`/api/chat` returns a `text/event-stream` response. Two SSE frame types:

```
data: {"type": "status", "text": "Thinking…"}   ← progress indicator
data: {"text": "word "}                          ← response text (no type = text)
```

Terminated by `data: [DONE]`.

| Tool | Status label |
|---|---|
| `search_nsm_by_company` | `Searching NSM filings…` |
| `search_nsm_by_lei` | `Searching NSM by LEI…` |
| `search_nsm_by_content` | `Searching NSM content…` |
| `fetch_pdf_summary` | `Reading document…` |
| `search_firds` | `Looking up FIRDS instrument…` |
| `search_fitrs` | `Searching FITRS files…` |
| `get_short_positions` | `Fetching short positions…` |

---

## AI Tools (Gemini Function Declarations)

The LLM has access to **seven tools**.

### NSM Tools

Split into three because the FCA API uses different `criteriaObj` shapes per case:

| Tool | Criterion | When to use |
|---|---|---|
| `search_nsm_by_company` | `company_lei: [name, "", "disclose_org", "related_org"]` | "Show me Barclays filings" |
| `search_nsm_by_lei` | `company_lei: ["", LEI_CODE, "disclose_org", "related_org"]` | User provides a LEI code |
| `search_nsm_by_content` | `document_content: [keywords, "any_word"]` | "Find docs mentioning climate risk" |

### FIRDS Tool — `search_firds`

Five search modes in priority order — the first non-empty param wins:

| Priority | Param | API field | Body shape |
|---|---|---|---|
| 1 | `instrument_id` | `fininstrmgnlattrbts_id` | `criteriaObj` |
| 2 | `isin` | `isin_bskt` | `criteriaObj` |
| 3 | `issuer_lei` | `issr` | `criteriaObj` |
| 4 | `classification` | `fininstrmgnlattrbts_clssfctntp` | `criteriaObj` |
| 5 | `instrument_name` | `keyword` field | `criteriaObj: null` |

All criteria-based searches include two standard base criteria: `techattrbts_nvrpblshd: "false"` and `active_flag: "Y"`.

Returns: ISIN, instrument ID, full name, short name, CFI code, MIC, issuer LEI, currency, first trade date, MiFIR reportability, and `detailUrl` (`https://data.fca.org.uk/#/moreinfo/{seq_id}`).

### FITRS Tool — `search_fitrs`

FITRS is a **file download index**, not a per-instrument lookup. It publishes MiFID II transparency calculation results as ZIP files containing XML.

| Param | Description |
|---|---|
| `date_from` | Start of publication date range (YYYY-MM-DD). Defaults to 30 days ago. |
| `date_to` | End of publication date range (YYYY-MM-DD). Defaults to today. |
| `file_type` | `"Full"` (weekly, all instruments) or `"Delta"` (daily, changed only). Omit for both. |

Returns: list of files with `fileName`, `fileType`, `publicationDate`, `downloadLink`, `lastRefreshed`.

### Other Tools

| Tool | Backend function | Description |
|---|---|---|
| `fetch_pdf_summary` | `fetchPDFSummary` | Downloads NSM PDF, extracts up to 50k chars, keyword-targeted window |
| `get_short_positions` | `getShortPositions` | Fetches FCA SSR positions, filters by issuer name or threshold |

---

## FCA API Details

### Base URLs

```
FCA_BASE     = https://data.fca.org.uk
FCA_API_BASE = https://api.data.fca.org.uk
```

### Common POST Search Pattern

NSM, FIRDS, and FITRS all use the same POST search API:

```
POST https://api.data.fca.org.uk/search?index={index-name}
Content-Type: application/json
```

| Register | Index name |
|---|---|
| NSM | `fca-nsm-searchdata` |
| FIRDS | `fca-firds-viewdata` |
| FITRS file index | `fca-fitrs-downloadfiles` |

**General body shape:**
```json
{
  "from": 0,
  "size": 20,
  "sort": "field_name",
  "sortorder": "asc|desc",
  "keyword": "search term or null",
  "criteriaObj": {
    "criteria": [ { "name": "field", "value": "value" } ],
    "dateCriteria": [ { "name": "field", "value": { "from": "...", "to": "..." } } ]
  }
}
```

When using `keyword` search, set `criteriaObj: null`. When using `criteriaObj`, set `keyword: null`.

### NSM-specific Notes

- **Date format:** ISO 8601 without milliseconds (`.000Z` is rejected — strip to `Z`)
- **Soft-block detection:** `took < 10ms` + `value: 0` = Cloudflare block (real ES always takes >10ms)
- **`latest_flag: Y`** must always be included in NSM criteria

### FIRDS-specific Notes

- **Base criteria always included:** `techattrbts_nvrpblshd: "false"` and `active_flag: "Y"`
- **Detail URL:** `https://data.fca.org.uk/#/moreinfo/{seq_id}` (seq_id is in every `_source`)
- **Key response fields:** `fininstrmgnlattrbts_fullnm` (name), `fininstrmgnlattrbts_shrtnm` (short name), `fininstrmgnlattrbts_clssfctntp` (CFI), `tradgvnrltdattrbts_id` (MIC), `issr` (issuer LEI), `isin_sngl_noindx` / `isin_sngl_indx` (ISIN)

### FITRS-specific Notes

- **Date format for `dateCriteria`:** `DD/MM/YYYY` (different from NSM which uses ISO 8601)
- **File types:** `Full` (weekly, every Saturday, split by CFI first letter) and `Delta` (daily, only changed records)
- **File naming:** `FULECR_YYYYMMDD_<CFI>_<n>of<total>.zip` / `DLTECR_YYYYMMDD_<n>of<total>.zip`
- **ZIP contents:** One XML file per ZIP, schema `auth.044.001.02`, contains `<EqtyTrnsprncyData>` records
- **XML key fields per record:** `<Id>` = ISIN, `<FinInstrmClssfctn>` = CFI, `<FullNm>` = name, `<Lqdty>` = liquid flag, `<Mthdlgy>` = ESTM/FFWK/YEAR, `<AvrgDalyTrnvr>` = avg daily turnover, `<LrgInScale>` = LIS threshold, `<RlvntMkt><Id>` = relevant market MIC

### FITRS ZIP Extraction (`/api/fitrs-file`)

```
GET /api/fitrs-file?url=https://data.fca.org.uk/artefacts/FITRS/FILES/DLTECR_...zip
```

- Only permits URLs starting with `https://data.fca.org.uk/artefacts/FITRS/`
- Downloads ZIP, extracts with `fflate`, parses XML with regex (no DOM parser)
- Returns `{ total: number, records: FITRSInstrumentRecord[] }`
- UI caps display at 200 rows with a live filter (ISIN / name / classification)

### Key NSM Response Fields

| Field | Description |
|---|---|
| `hits.total.value` | Total matching records |
| `_source.headline` | Filing title |
| `_source.company` | Filer name (may end with `;` — trim it) |
| `_source.type` | Human-readable filing type |
| `_source.type_code` | Short code (e.g. "RET", "HOL") |
| `_source.lei` | LEI of primary filer |
| `_source.related_org[]` | Related orgs with `lei` and `company` |
| `_source.source` | "RNS", "Direct Upload", "EQS", "FCA" |
| `_source.download_link` | Relative path; prepend `https://data.fca.org.uk/artefacts/` |
| `_source.publication_date` | When published |
| `_source.submitted_date` | When submitted |

### NSM Filing Type Aliases

`resolveFilingType()` in `fca-tools.ts` maps friendly names to API values:

| Alias | API value |
|---|---|
| "annual report" / "annual reports" | `Annual Report` |
| "prospectus" | `Prospectus` |
| "circular" / "circulars" / "offering circular" | `Circ re.` |
| "holding" / "holdings" / "major holdings" | `Holding(s) in Company` |
| "form 8.3" | `Form 8.3` |
| "form 8.5" | `Form 8.5 (EPT/NON-RI)` |
| "admission" / "admission to trading" | `Admission to Trading` |
| "final terms" | `Final Terms` |
| "supplementary prospectus" | `Publication of a Supplementary Prospectus` |
| "irish takeover" | `Irish Takeover Panel` |
| "net asset value" / "nav" | `Net Asset Value(s)` |
| "miscellaneous" | `Miscellaneous` |

### Cloudflare Blocking — NSM Known Issue

The NSM endpoint is protected by Cloudflare Bot Management. Vercel serverless IPs get soft-blocked intermittently.

**Approaches tried:**

| Approach | Result |
|---|---|
| `curl` subprocess (different TLS fingerprint) | Still blocked — IP-based, not TLS |
| Retry with 1s/2s backoff inside `fcaPost` | Added 6.5s overhead, still blocked — reverted |
| `company_lei` → `document_content` fallback on 0 results | Doubled blocked calls — reverted |
| Edge-runtime proxy `/api/fca-proxy` + `VERCEL_AUTOMATION_BYPASS_SECRET` | **Currently in use** — `fcaPost` detects `VERCEL_URL` and routes through edge proxy with bypass header |

**Options not yet tried:**
- Commercial rotating residential proxy (Bright Data, Oxylabs etc.)

**Mitigation in place:**
- `nsmCache` caches successful results for 2 hours keyed by search params
- Soft-block detection: `took < 10ms` + `value === 0` → retry up to 3 times with 800ms delay

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Primary Google Gemini API key |
| `GEMINI_API_KEY_BACKUP` | No | Backup Gemini key — used automatically if primary hits quota (429/RESOURCE_EXHAUSTED) |
| `VERCEL_URL` | Auto (Vercel) | Used by `fcaPost` to detect Vercel environment and route NSM via edge proxy |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel only | Adds `x-vercel-protection-bypass` header to edge proxy self-calls |

Add to `.env.local` for local development.

---

## Rate Limiting

`/api/chat` applies a simple in-memory rate limit: **20 requests per IP per minute**. Exceeds → 429. Resets on server restart — not suitable for production.

---

## Short Selling Data

Positions are fetched from the FCA SSR endpoint and cached in-memory for **2 hours** (`CACHE_TTL`). Cache resets on cold starts. Filtered in-memory by `issuer_name` and/or `above_threshold` after fetch.

---

## Running Locally

```bash
npm install
echo "GEMINI_API_KEY=your_key_here" > .env.local
npm run dev
```

App runs at `http://localhost:3000`.

---

## Model Behaviour (System Prompt)

### Tool routing
- Broad NSM queries → **search first**, then ask a clarifying question in the same response using results already in context
- Company name → `search_nsm_by_company`; LEI code → `search_nsm_by_lei`; topic/keyword → `search_nsm_by_content`
- FIRDS → use the most precise identifier available (instrument_id > isin > issuer_lei > classification > name)
- FITRS → browse by date range; remind user files are ZIP downloads containing XML transparency data
- PDF fetch only triggered when user explicitly asks for content from inside a document

### PDF extraction (`fetchPDFSummary`)
- **50,000 character limit**
- `extraction_prompt` scans full document and returns a window around the first keyword match
- Returns metadata header: page count and total character count

### Prompt injection & off-topic filter

Two-layer defence in `chat/route.ts`:

**Layer 1 — `guardInput()` pre-filter:**

| Check | Detail |
|---|---|
| Length cap | Rejects messages > 2,000 chars |
| Injection patterns | 7 regexes: "ignore previous instructions", "you are now a…", "reveal your system prompt", "jailbreak", etc. |
| Off-topic | 17 patterns, only triggered when no FCA signals present |

**Layer 2 — System prompt hardening:** `## Security & scope` section instructs Gemini to refuse off-topic questions and ignore injected instructions.

---

## Key Design Decisions

- **Three NSM search tools** — `criteriaObj` shape is fundamentally different for company vs. content searches; one generic tool caused wrong criterion usage.
- **`company_lei` over `document_content` for company searches** — `document_content` searches document bodies, not company name index.
- **`disclose_org` + `related_org` scope flags** — without these, API only matches on the primary `lei` field.
- **LEI vs. name tradeoff** — name search returns ~2.6× more results (matches fund names); LEI search is scoped to the legal entity.
- **Five FIRDS search modes with priority ordering** — criteria-based searches (instrument_id, ISIN, issuer LEI, classification) are more precise than keyword. Priority ensures the most specific identifier is always used.
- **FIRDS detail URL from `seq_id`** — every FIRDS hit contains `seq_id`; `https://data.fca.org.uk/#/moreinfo/{seq_id}` links to the full instrument detail page.
- **FITRS is a file index, not a lookup API** — the correct API returns ZIP files containing XML with thousands of instrument records. The old per-ISIN proxy endpoint does not exist. The `/api/fitrs-file` route handles download + extraction + parsing server-side.
- **FITRS date format is DD/MM/YYYY** — unlike NSM (ISO 8601). Always convert before sending.
- **`fflate` for ZIP extraction** — lightweight, works in Node.js without native bindings. XML parsed with regex (no DOM parser available in Node.js without additional dependencies).
- **Date descriptions embed today's date** — `dateFromDesc()` / `dateToDesc()` called at request time so LLM resolves relative phrases correctly.
- **Pre-filter before Gemini** — `guardInput()` blocks injection and off-topic queries server-side, saving API calls.
- **Streaming over JSON** — SSE keeps UI responsive during multi-turn tool calls.
- **Gemini backup key fallback** — `withRetry` in `chat/route.ts` accepts a key index and iterates through `getApiKeys()` (primary then backup). Quota errors (429 / `RESOURCE_EXHAUSTED` / `quota`) immediately switch to the next key with no delay. Transient errors (503) retry the same key up to 3 times with 1s/2s backoff. Non-retryable errors propagate immediately. The chat session is recreated with the new key on each call — no context is lost as history is passed from the request body. Configure via `GEMINI_API_KEY_BACKUP`; if unset, behaviour is unchanged.
