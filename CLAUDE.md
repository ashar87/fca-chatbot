# FCA Data Portal — Chatbot Demo

A visual clone of [data.fca.org.uk](https://data.fca.org.uk) with an embedded AI chatbot that answers questions using live FCA public data. Built as a stakeholder demo; not a production deployment.

> **Keeping this file current:** Update CLAUDE.md whenever you add a new API endpoint, change a search function, add a new tool to Gemini, or discover a new FCA API behaviour. The sections most likely to go stale are: [AI Tools](#ai-tools-gemini-function-declarations), [FCA API Details](#fca-api-details), [REST API Endpoints](#rest-api-endpoints), and [Key Design Decisions](#key-design-decisions).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI Model (primary) | Claude via AWS Bedrock (eu-west-1, temp credentials — expires hourly) via `@aws-sdk/client-bedrock-runtime` |
| AI Model (fallback) | Gemini 2.5 Flash (`gemini-2.5-flash`, thinking disabled) via `@google/genai` v2.7.0 |
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
│   ├── globals.css                  # CSS variables, FCA form/table/sidebar/chat classes
│   └── api/
│       ├── chat/route.ts            # AI chat endpoint (POST, streaming SSE)
│       ├── fca-proxy/route.ts       # Edge-runtime proxy for NSM (bypasses Cloudflare)
│       ├── nsm/route.ts             # NSM search REST endpoint (GET)
│       ├── firds/route.ts           # FIRDS search REST endpoint (GET)
│       ├── fitrs/route.ts           # FITRS file index search endpoint (GET)
│       └── fitrs-file/route.ts      # FITRS ZIP download + XML parse endpoint (GET)
├── components/
│   ├── ChatWidget.tsx               # Floating chat panel, SSE streaming, starter prompts
│   ├── Header.tsx                   # White header with FCA logo
│   ├── NavBar.tsx                   # Purple full-width nav bar
│   ├── Sidebar.tsx                  # Left sidebar — accordion sections, register links
│   ├── Footer.tsx                   # Dark footer
│   ├── NavTabs.tsx                  # Exports PortalSection type (no rendered component)
│   ├── NSMSearchPage.tsx            # NSM search form matching real portal layout
│   ├── FIRDSSearchPage.tsx          # FIRDS instrument search page
│   └── FITRSSearchPage.tsx          # FITRS file browser with inline ZIP/XML extraction
└── lib/
    ├── fca-tools.ts                 # All FCA API calls + data models
    └── bedrock-provider.ts          # AWS Bedrock client, tool/history conversion, agentic loop
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
│   - Short Selling │ (greyed out — disabled)         │
├───────────────────┴─────────────────────────────────┤
│ [DARK FOOTER — copyright | back to top | links]     │
└─────────────────────────────────────────────────────┘
```

## Navigation Type

`PortalSection` (in `NavTabs.tsx`):
```ts
type PortalSection = "nsm-search" | "nsm-about" | "firds" | "fitrs";
// "short-selling" is commented out — re-enable once correct FCA API endpoint is confirmed
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
| `.fca-btn-primary` | Purple button, no border-radius, yellow `:focus-visible` ring |
| `.fca-btn-secondary` | Grey secondary button, yellow `:focus-visible` ring |
| `.fca-table` | Results table with purple header, alternating rows |
| `.sidebar-section-header` | Purple sidebar section header |
| `.sidebar-item` | Grey sub-item (for NSM sub-pages) |
| `.sidebar-link` | Blue-link register items |
| `.content-panel` | Bordered white content area |
| `.chat-input` | Chat text input — CSS-only yellow focus ring (no JS handlers) |
| `.sr-only` | Visually hidden — accessible to screen readers only |

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
    │  Provider selection (per request):
    │    AWS creds present? → Claude via Bedrock (bedrock-provider.ts)
    │    Absent or expired? → Gemini 2.5 Flash (withRetry, primary + backup key)
    │  ├── tool call → executeTool()
    │  │       └── fca-tools.ts functions
    │  │               └── POST to api.data.fca.org.uk (via edge proxy on Vercel)
    │  └── final text → SSE stream back to client
    ▼
ChatWidget (renders markdown, streams word-by-word, links open in new tab)
```

The chat route runs an **agentic loop** (max 5 turns): the active provider (Bedrock or Gemini) can call multiple tools in sequence before producing a final answer.

### Agentic Loop — localHistory (Gemini path)

Each Gemini turn creates a fresh `client.chats.create({ history })`. To ensure the function call / function response pairs remain contiguous across turns (required by the Gemini API), a `localHistory` array grows after each turn:

```
turn 1:  localHistory = [initial messages]  →  model returns function call
         localHistory += [user parts sent] + [model function call parts]
turn 2:  localHistory = [initial + turn 1 exchange]  →  model reads results, returns text
```

Without this, turn 2 would send function response parts with no preceding function call in history, causing a 400 `INVALID_ARGUMENT` error. This also makes key-switching safe — a new key always gets the full context.

The Bedrock path (`bedrock-provider.ts`) manages its own `anthropicMessages` array that grows equivalently — `assistant` messages with `tool_use` blocks are immediately followed by `user` messages with `tool_result` blocks, as required by the Anthropic API.

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

---

## REST API Endpoints

All endpoints are internal — called by the UI pages and the chat route's `executeTool()`. They are thin wrappers over `fca-tools.ts` functions.

### `GET /api/nsm`

NSM search. Mode is selected by the `mode` param.

| Param | Values | Description |
|---|---|---|
| `mode` | `company` (default), `lei`, `content` | Search mode |
| `query` | string | Company name (mode=company) |
| `lei` | string | LEI code (mode=lei) |
| `keywords` | string | Keywords (mode=content) |
| `match_mode` | `any_word`, `all_words`, `exact_match` | Match behaviour for content search |
| `date_from` / `date_to` | YYYY-MM-DD | Filing date range |
| `pub_date_from` / `pub_date_to` | YYYY-MM-DD | Publication date range (takes priority over date_from/to) |
| `source` | string | Optional source filter (e.g. "RNS") |

Returns: `{ results: NSMFiling[], total: number }`

### `GET /api/firds`

FIRDS instrument lookup. At least one param required.

| Param | Description |
|---|---|
| `isin` | ISIN code (e.g. GB0002875804) |
| `instrument_id` | Instrument identification code |
| `issuer_lei` | LEI of issuer |
| `classification` | CFI classification code |
| `name` | Keyword / instrument name |

Returns: `{ results: FIRDSInstrument[], total: number }`

### `GET /api/fitrs`

FITRS file index search.

| Param | Description |
|---|---|
| `date_from` | Start of publication date range (YYYY-MM-DD) |
| `date_to` | End of publication date range (YYYY-MM-DD) |
| `file_type` | `Full` or `Delta` |
| `keyword` | Optional keyword filter on file name |

Returns: `{ total: number, files: FITRSFile[] }`

### `GET /api/fitrs-file`

Downloads a FITRS ZIP file and parses the XML inside it server-side.

| Param | Description |
|---|---|
| `url` | Full URL of a FITRS ZIP file — must start with `https://data.fca.org.uk/artefacts/FITRS/` |

Returns: `{ total: number, records: FITRSInstrumentRecord[] }`

Only FCA artefact URLs are permitted — any other URL returns 400.

### `POST /api/fca-proxy`

Edge-runtime pass-through proxy for `api.data.fca.org.uk`. Used internally by `fcaPost()` when running on Vercel to route NSM requests through CDN edge IPs (bypasses Cloudflare blocking).

| Query param | Description |
|---|---|
| `index` | FCA index name (e.g. `fca-nsm-searchdata`) |

Body is forwarded verbatim to the FCA API. Response is forwarded back.

Not intended to be called directly from the UI.

### `POST /api/chat`

AI chat endpoint. Accepts conversation history, runs the agentic loop (Bedrock primary, Gemini fallback), streams SSE.

| Body field | Description |
|---|---|
| `messages` | Array of `{ role: "user" \| "assistant", content: string }` |
| `context` | Active portal section (passed for routing context) |

Returns: `text/event-stream` — see [Streaming](#streaming) above.

Rate limited: 20 requests per IP per minute (in-memory, resets on server restart).

---

## AI Tools (Function Declarations)

The LLM has access to **six tools** (short selling disabled).

### NSM Tools

Split into three because the FCA API uses different `criteriaObj` shapes per case:

| Tool | Criterion | When to use |
|---|---|---|
| `search_nsm_by_company` | `company_lei: [name, "", "disclose_org", "related_org"]` | "Show me Barclays filings" |
| `search_nsm_by_lei` | `company_lei: ["", LEI_CODE, "disclose_org", "related_org"]` | User provides a LEI code |
| `search_nsm_by_content` | `document_content: [keywords, "any_word"]` | "Find docs mentioning climate risk" |

All NSM tools return **10 results per page** (down from 50 — reduces latency). Use `page: 1`, `page: 2` etc. to paginate when the user asks for more.

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
| `fetch_pdf_summary` | `fetchPDFSummary` | Downloads NSM PDF or HTML document, extracts up to 50k chars, multi-word keyword anchor search |

### Disabled Tools

| Tool | Reason |
|---|---|
| `get_short_positions` | SSR API endpoint not confirmed — all code commented out, not deleted |

To re-enable: uncomment in `chat/route.ts` (import, tool declaration, status label, executeTool case), `NavTabs.tsx`, `Sidebar.tsx`, `ChatWidget.tsx`, and `page.tsx`.

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
  "size": 10,
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
- **Page size:** 10 results per page (`size: 10`). Paginate with `from: page * 10`.

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
| `AWS_ACCESS_KEY_ID` | Primary provider | AWS temporary credential (refresh hourly via `aws sso login` or equivalent) |
| `AWS_SECRET_ACCESS_KEY` | Primary provider | AWS temporary credential |
| `AWS_SESSION_TOKEN` | Primary provider | AWS session token — absence causes automatic fallback to Gemini |
| `AWS_REGION` | No | AWS region for Bedrock (default: `eu-west-1`) |
| `BEDROCK_MODEL_ID` | No | Bedrock model ARN (default: FCA inference profile ARN) |
| `GEMINI_API_KEY` | Fallback | Primary Google Gemini API key — used when AWS creds absent or expired |
| `GEMINI_API_KEY_BACKUP` | No | Backup Gemini key — used if primary hits quota (429/RESOURCE_EXHAUSTED) |
| `VERCEL_URL` | Auto (Vercel) | Used by `fcaPost` to detect Vercel environment and route NSM via edge proxy |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel only | Adds `x-vercel-protection-bypass` header to edge proxy self-calls |

Add to `.env.local` for local development.

---

## Rate Limiting

`/api/chat` applies a simple in-memory rate limit: **20 requests per IP per minute**. Exceeds → 429. Resets on server restart — not suitable for production.

---

## Running Locally

```bash
npm install
# Populate .env.local with AWS credentials (primary) and/or GEMINI_API_KEY (fallback)
npm run dev
```

App runs at `http://localhost:3000`.

---

## Chat Widget

The floating chat widget (`ChatWidget.tsx`) has the following behaviours:

- **Trigger button** bottom-right, visible when panel is closed
- **Panel** opens as a fixed overlay (380px wide, adaptive height: `min(520px, calc(100dvh - 96px))`)
- **Section subtitle** in header shows active register context (NSM / FIRDS / FITRS)
- **Starter prompts** shown when no messages; accessible via 💡 button during a conversation
- **Clear conversation** requires two clicks — first click shows "Confirm?", second click clears. Auto-reverts after 3 seconds.
- **Disclaimer** ("Not financial or regulatory advice") shown only on the last completed assistant message, not on every message
- **Links open in new tab** — all `<a>` elements rendered by `react-markdown` have `target="_blank" rel="noopener noreferrer"`
- **Accessibility:** `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-label` on all icon buttons, `aria-live` regions for status text and completed responses, focus trap (input focuses on open, trigger refocuses on close)
- **Focus ring** on chat input is CSS-only via `.chat-input:focus` — no JS `onFocus`/`onBlur` handlers

---

## Model Behaviour (System Prompt)

### Tool routing
- Broad NSM queries → **search first**, then ask a clarifying question in the same response using results already in context
- Company name → `search_nsm_by_company`; LEI code → `search_nsm_by_lei`; topic/keyword → `search_nsm_by_content`
- FIRDS → use the most precise identifier available (instrument_id > isin > issuer_lei > classification > name)
- FITRS → browse by date range; remind user files are ZIP downloads containing XML transparency data
- PDF/HTML fetch only triggered when user explicitly asks for content from inside a document
- NSM returns 10 results; model uses `page: 1`, `page: 2` etc. when user asks for more/older results

### Document extraction (`fetchPDFSummary`)
- Supports **PDF** (via `pdf-parse`) and **HTML** (tag-stripped, entity-decoded)
- Format detected from `Content-Type` header or `.html`/`.htm` URL suffix
- **50,000 character limit**
- `extraction_prompt` uses multi-word anchor search: tries full phrase first, then individual words (stopwords skipped), returns a window around the earliest hit
- Falls back to returning the document from the beginning if no keyword matches
- Returns metadata header: page count (PDF) or total char count, and chars shown

### Prompt injection & off-topic filter

Two-layer defence in `chat/route.ts`:

**Layer 1 — `guardInput()` pre-filter:**

| Check | Detail |
|---|---|
| Length cap | Rejects messages > 2,000 chars |
| Injection patterns | 7 regexes: "ignore previous instructions", "you are now a…", "reveal your system prompt", "jailbreak", etc. |
| Off-topic | 17 patterns, only triggered when no FCA signals present |

**Layer 2 — System prompt hardening:** `## Security & scope` section instructs the model to refuse off-topic questions and ignore injected instructions.

---

## Key Design Decisions

- **Three NSM search tools** — `criteriaObj` shape is fundamentally different for company vs. content searches; one generic tool caused wrong criterion usage.
- **`company_lei` over `document_content` for company searches** — `document_content` searches document bodies, not company name index.
- **`disclose_org` + `related_org` scope flags** — without these, API only matches on the primary `lei` field.
- **LEI vs. name tradeoff** — name search returns ~2.6× more results (matches fund names); LEI search is scoped to the legal entity.
- **NSM page size reduced to 10** — was 50; reduces FCA API response time significantly. Gemini paginates on user request using `page` param.
- **Five FIRDS search modes with priority ordering** — criteria-based searches (instrument_id, ISIN, issuer LEI, classification) are more precise than keyword. Priority ensures the most specific identifier is always used.
- **FIRDS detail URL from `seq_id`** — every FIRDS hit contains `seq_id`; `https://data.fca.org.uk/#/moreinfo/{seq_id}` links to the full instrument detail page.
- **FITRS is a file index, not a lookup API** — the correct API returns ZIP files containing XML with thousands of instrument records. The old per-ISIN proxy endpoint does not exist. The `/api/fitrs-file` route handles download + extraction + parsing server-side.
- **FITRS date format is DD/MM/YYYY** — unlike NSM (ISO 8601). Always convert before sending.
- **`fflate` for ZIP extraction** — lightweight, works in Node.js without native bindings. XML parsed with regex (no DOM parser available in Node.js without additional dependencies).
- **Date descriptions embed today's date** — `dateFromDesc()` / `dateToDesc()` called at request time so LLM resolves relative phrases correctly.
- **Pre-filter before LLM** — `guardInput()` blocks injection and off-topic queries server-side, saving API calls.
- **Streaming over JSON** — SSE keeps UI responsive during multi-turn tool calls.
- **Gemini backup key fallback** — `withRetry` in `chat/route.ts` accepts a key index and iterates through `getApiKeys()` (primary then backup). Quota errors (429 / `RESOURCE_EXHAUSTED` / `quota`) immediately switch to the next key with no delay. Transient errors (503) retry the same key up to 3 times with 1s/2s backoff. Non-retryable errors propagate immediately. Configure via `GEMINI_API_KEY_BACKUP`; if unset, behaviour is unchanged.
- **`localHistory` grows per turn (Gemini)** — each agentic loop turn appends the sent parts + model function call parts to `localHistory`. This ensures function response parts always follow a function call in history, preventing 400 `INVALID_ARGUMENT` errors on turn 2+. Also makes key-switching safe mid-loop.
- **AWS Bedrock as primary provider** — `isBedrockAvailable()` checks for all three AWS credential env vars at request time (no network call). If credentials are present, `runBedrockLoop()` in `bedrock-provider.ts` is tried first. Auth errors (`ExpiredTokenException`, `UnrecognizedClientException`, HTTP 403) are caught and the request falls through to Gemini transparently. Non-auth errors propagate normally.
- **Tool declarations converted per provider** — `TOOL_DECLARATIONS` is in Gemini format (uppercase types, `parameters`). `toAnthropicTools()` converts to Anthropic format (lowercase types, `input_schema`) at call time; no duplication of declarations.
- **Chat result format enforced via system prompt** — NSM results must be bullet lists (`- **[Headline](url)** — Type · Date`); FIRDS and FITRS also use bullet format. Tables are avoided as they render poorly in the chat widget.
- **Document links open in new tab** — `react-markdown` `components` prop overrides `<a>` with `target="_blank"` so users can read documents without losing their chat session.
- **HTML document support in `fetchPDFSummary`** — detected via `Content-Type: text/html` or `.html`/`.htm` suffix. Tags and common entities stripped with regex; same 50k-char extraction window applied.
- **Multi-word keyword anchor search** — `findBestAnchor()` tries the full phrase first, then falls back to individual meaningful words (stopwords excluded). Returns the earliest hit position, so partial prompts like "director PDMR shareholding" reliably anchor to the relevant section.
- **Short selling disabled** — `get_short_positions` tool and all related UI are commented out (not deleted). The SSR proxy endpoints tried (`/api/proxy/ssr/positions`, `/api/proxy/public/short-positions`) returned no data. Re-enable once the correct FCA API endpoint is confirmed.
