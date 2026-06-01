# FCA Data Portal — Chatbot Demo

A visual clone of [data.fca.org.uk](https://data.fca.org.uk) with an embedded AI chatbot that answers questions using live FCA public data. Built as a stakeholder demo; not a production deployment.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI Model | Gemini 2.5 Flash (`gemini-2.5-flash`, thinking disabled) via `@google/genai` v2.7.0 |
| PDF extraction | `pdf-parse` |
| Markdown rendering | `react-markdown` |
| Deployment target | Vercel |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                  # Root page — two-column layout, section state
│   ├── layout.tsx                # HTML shell, global font/metadata
│   ├── globals.css               # CSS variables, FCA form/table/sidebar classes
│   └── api/
│       ├── chat/route.ts         # AI chat endpoint (POST, streaming SSE)
│       ├── nsm/route.ts          # NSM search REST endpoint (GET)
│       ├── firds/route.ts        # FIRDS search REST endpoint (GET)
│       ├── fitrs/route.ts        # FITRS lookup REST endpoint (GET)
│       └── short-selling/route.ts# Short selling REST endpoint (GET)
├── components/
│   ├── ChatWidget.tsx            # Floating chat panel, SSE streaming, starter prompts
│   ├── Header.tsx                # White header with FCA logo (SVG chevron + wordmark)
│   ├── NavBar.tsx                # Purple full-width nav bar (Homepage + Print)
│   ├── Sidebar.tsx               # Left sidebar — accordion sections, register links
│   ├── Footer.tsx                # Dark footer (copyright, back-to-top, links)
│   ├── NavTabs.tsx               # Exports PortalSection type (no rendered component)
│   ├── NSMSearchPage.tsx         # NSM search form matching real portal layout
│   ├── FIRDSSearchPage.tsx       # FIRDS instrument lookup page
│   ├── FITRSSearchPage.tsx       # FITRS transparency data page
│   └── ShortSellingPage.tsx      # Short selling register page
└── lib/
    └── fca-tools.ts              # All FCA API calls + data models
```

## Page Layout

The page uses a two-column layout matching the real FCA Data Portal:

```
┌─────────────────────────────────────────────────────┐
│ [DEMO BANNER — yellow]                              │
├─────────────────────────────────────────────────────┤
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

`PortalSection` (in `NavTabs.tsx`) replaces the old `PortalTab`:
```ts
type PortalSection = "nsm-search" | "nsm-about" | "firds" | "fitrs" | "short-selling";
```

## CSS Design System

`globals.css` defines reusable FCA-style classes used across all search pages:

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
| `--fca-purple` | `#701b45` | Primary — headers, buttons, sidebar (sampled directly from logo PNG) |
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
    │  │               └── fetch/POST to data.fca.org.uk / api.data.fca.org.uk
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

**Status events** are emitted at four moments in the agentic loop:
1. Before the first Gemini call → `"Thinking…"`
2. When a tool call is detected → tool-specific label (see table below)
3. After tools complete, before the next Gemini turn → `"Processing results…"`
4. Text chunks have no `type` field — absence means text

| Tool | Status label |
|---|---|
| `search_nsm_by_company` | `Searching NSM filings…` |
| `search_nsm_by_lei` | `Searching NSM by LEI…` |
| `search_nsm_by_content` | `Searching NSM content…` |
| `fetch_pdf_summary` | `Reading document…` |
| `search_firds` | `Looking up FIRDS instrument…` |
| `search_fitrs` | `Looking up FITRS data…` |
| `get_short_positions` | `Fetching short positions…` |

**ChatWidget rendering:**
- `{"type":"status"}` → updates `statusText` state, shown as an animated clock-icon pill inside the assistant bubble while content is empty
- `{"text":...}` → clears `statusText`, appends to accumulated content with a `▌` cursor
- On completion → disclaimer appears below the message

---

## AI Tools (Gemini Function Declarations)

The LLM has access to six tools. Descriptions are crafted to guide Gemini toward the correct tool for each question type.

### NSM Tools

The NSM search is split into **three distinct tools** because the FCA search API uses different `criteriaObj` shapes for each case:

| Tool | Criterion | When to use |
|---|---|---|
| `search_nsm_by_company` | `company_lei: [name, "", "disclose_org", "related_org"]` | "Show me Barclays filings" |
| `search_nsm_by_lei` | `company_lei: ["", LEI_CODE, "disclose_org", "related_org"]` | User provides/knows a LEI code |
| `search_nsm_by_content` | `document_content: [keywords, "exact_match"]` | "Find docs mentioning climate risk" |

All three include `latest_flag: Y`, `sort: submitted_date`, and optional `type` + date range filters.

The `company_lei` value array format is: `[text_search, lei_search, scope_flag_1, scope_flag_2]`. Including `"disclose_org"` and `"related_org"` causes the API to also match documents where the company appears as a disclosing or related organisation (not just the primary filer).

**Key insight from real API responses:** A text name search ("barclays") returns ~52k results including ETFs with "Barclays" in their fund name. A LEI search returns ~20k results scoped precisely to Barclays PLC's own filings and related disclosures.

### Other Tools

| Tool | Backend function | FCA endpoint |
|---|---|---|
| `fetch_pdf_summary` | `fetchPDFSummary` | Direct PDF URL → `pdf-parse` (50k char limit, keyword-targeted) |
| `search_firds` | `searchFIRDS` | `/api/proxy/firds/instruments` |
| `search_fitrs` | `searchFITRS` | `/api/proxy/fitrs/bonds/{isin}` |
| `get_short_positions` | `getShortPositions` | `/api/proxy/ssr/positions` |

---

## FCA API Details

### Base URLs

```
FCA_BASE     = https://data.fca.org.uk
FCA_API_BASE = https://api.data.fca.org.uk
```

### NSM Search Endpoint

```
POST https://api.data.fca.org.uk/search?index=fca-nsm-searchdata
Content-Type: application/json
Origin: https://data.fca.org.uk
```

**Request body shape:**
```json
{
  "from": 0,
  "size": 50,
  "sort": "submitted_date",
  "sortorder": "desc",
  "criteriaObj": {
    "criteria": [
      { "name": "company_lei", "value": ["text", "LEI", "disclose_org", "related_org"] },
      { "name": "latest_flag", "value": "Y" }
    ],
    "dateCriteria": [
      { "name": "publication_date", "value": { "from": null, "to": "2026-05-29T22:36:00Z" } },
      { "name": "submitted_date",   "value": { "from": null, "to": "2026-05-29T22:36:00Z" } }
    ]
  }
}
```

**Important:** The API rejects ISO timestamps that contain milliseconds (`.000Z`). Always strip milliseconds before sending dates.

### Cloudflare Blocking — Known Issue

The NSM search endpoint is protected by Cloudflare Bot Management. When Vercel's serverless function IPs are rate-throttled, the API returns a legitimate-looking 200 response with `took: 2ms` and `value: 0` — a soft-block rather than an HTTP error.

**Observed behaviour:**
- `took < 10ms` + `value: 0` → Cloudflare soft-block (real Elasticsearch searches always take >10ms)
- `took > 10ms` + results → genuine response
- Blocking is rate-based and intermittent — later turns in the same request often get through after a few seconds have passed

**Mitigation in place:**
- `nsmCache` (in `fca-tools.ts`) caches successful search results for 2 hours. Once a query gets through Cloudflare, all subsequent identical queries are served from cache with no FCA API call.

**Approaches tried and their outcomes:**

| Approach | Result |
|---|---|
| `curl` subprocess (different TLS fingerprint) | Still blocked — Cloudflare is filtering on IP, not TLS fingerprint |
| Retry with 1s/2s backoff inside `fcaPost` | Blocked the same; added 6.5s overhead per call — reverted |
| `company_lei` → `document_content` fallback on 0 results | Doubled blocked calls per turn — reverted |
| Edge-runtime proxy at `/api/fca-proxy` | 401 from Vercel Deployment Protection on self-calls — reverted |

**Options not yet tried:**
- Vercel Protection Bypass Secret (`VERCEL_AUTOMATION_BYPASS_SECRET` env var + `x-vercel-protection-bypass` header) to make the edge proxy self-call work
- Commercial rotating residential proxy service (Bright Data, Oxylabs etc.)

### Key NSM Response Fields

| Field | Description |
|---|---|
| `hits.total.value` | Total number of matching records (not just the current page) |
| `_source.headline` | Filing title / headline |
| `_source.company` | Filer company name (may end with `;` — trim it) |
| `_source.type` | Human-readable filing type (e.g. "Form 8.3", "Holding(s) in Company") |
| `_source.type_code` | Short code (e.g. "RET", "HOL", "ADM", "FEO") |
| `_source.lei` | LEI of the primary filer |
| `_source.related_org[]` | Array of related organisations with `lei` and `company` |
| `_source.source` | Submission channel: "RNS", "Direct Upload", "EQS", "FCA" |
| `_source.download_link` | Relative path; prepend `https://data.fca.org.uk/artefacts/` |
| `_source.publication_date` | When published to NSM |
| `_source.submitted_date` | When submitted by the filer |

### Filing Type Aliases

Friendly names the LLM passes are mapped to actual API `type` values in `resolveFilingType()`:

| Alias | API value |
|---|---|
| "annual report" | `Annual Report` |
| "circular" / "offering circular" | `Circ re.` |
| "holding" / "major holdings" | `Holding(s) in Company` |
| "form 8.3" | `Form 8.3` |
| "form 8.5" | `Form 8.5 (EPT/NON-RI)` |
| "admission" | `Admission to Trading` |
| "irish takeover" | `Irish Takeover Panel` |
| "nav" | `Net Asset Value(s)` |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |

Add to `.env.local` for local development.

---

## Rate Limiting

`/api/chat` applies a simple in-memory rate limit: **20 requests per IP per minute**. Exceeds → 429. This resets on server restart and is not suitable for production.

---

## Short Selling Data

Positions are fetched from the FCA SSR endpoint and cached in-memory for **2 hours** (`CACHE_TTL`). The cache lives on the server process — it resets on cold starts.

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

The system prompt in `chat/route.ts` governs three areas:

### Tool routing
- Broad company queries → ask clarifying question (filing type, date range) before searching
- Company name → `search_nsm_by_company`; LEI code → `search_nsm_by_lei`; topic/keyword → `search_nsm_by_content`
- PDF fetch only triggered when user explicitly asks for content from a document — not on search results

### PDF extraction (`fetchPDFSummary`)
- **50,000 character limit** (raised from 3,000)
- `extraction_prompt` is used to scan the full document and return a focused window around the first keyword match — much more useful for large annual reports
- Returns metadata header: page count and total document size

### Prompt injection & off-topic filter

Two-layer defence in `chat/route.ts`:

**Layer 1 — `guardInput()` pre-filter** (runs before Gemini is called):
| Check | Detail |
|---|---|
| Length cap | Rejects messages > 2,000 chars (token-stuffing) |
| Injection patterns | 7 regexes: "ignore previous instructions", "you are now a...", "reveal your system prompt", "jailbreak", etc. |
| Off-topic | 16 patterns block clearly unrelated queries only if no FCA signals are present in the message |

Off-topic pattern categories (all guarded by `FCA_SIGNALS` absence check):
- **Original**: jokes, poems, recipes, weather, sports, president, capital-of, translate, summarise-article
- **General knowledge**: "what is the capital/population of…", "how does X work", science terms (photosynthesis, gravity, etc.)
- **Coding/tech**: "write/debug a function", "python code/tutorial", etc.
- **Creative writing**: "write a story/essay/cover letter/speech/blog"
- **Personal/lifestyle**: "recommend a restaurant/hotel/movie", "plan my holiday"
- **News/current events**: "latest news", "what happened in/at/to"
- **Catch-all**: messages starting with `what is / what are / who is / explain / tell me about / how do I / how does` with no FCA signals — blocks the broadest category of unrelated questions with a single pattern

Blocked messages receive the polite redirect as a streamed SSE response — no Gemini API call is made.

**Layer 2 — System prompt hardening**: A `## Security & scope` section tells Gemini to refuse off-topic questions and ignore injected instructions that make it through the pre-filter.

---

## Key Design Decisions

- **Three NSM search tools instead of one** — the FCA API's `criteriaObj` is fundamentally different for company-identity searches vs. document-content searches. A single generic tool caused the LLM to use the wrong criterion and return irrelevant results.
- **`company_lei` over `document_content` for company searches** — `document_content` with `exact_match` searches inside document bodies; it is not a company name index. Company-name resolution must use the `company_lei` criterion.
- **`disclose_org` + `related_org` scope flags** — without these, the API only matches on the primary `lei` field and misses documents where the company is a related/disclosing org.
- **LEI vs. name search tradeoff** — name-based gives ~2.6× more results than LEI-based for Barclays, because name search matches funds/ETFs that merely reference "Barclays" in their name. LEI search is scoped to the legal entity.
- **`any_word` for content searches, `exact_match` for company searches** — `search_nsm_by_content` uses `any_word` so keyword queries return broad, useful results. Company/LEI searches don't use the `document_content` criterion at all, so match mode is irrelevant there.
- **Date descriptions embed today's date** — `dateFromDesc()` and `dateToDesc()` are called at request time (not module load) and inject the current date so the LLM can correctly resolve relative phrases like "last week" or "since March" into YYYY-MM-DD values.
- **Clarifying questions before searching** — the system prompt instructs Gemini to ask for filing type or date range when a query is broad, rather than returning 50k unfiltered results.
- **Pre-filter before Gemini** — `guardInput()` blocks obvious injection attempts and off-topic queries server-side, preventing unnecessary API calls and reducing attack surface.
- **Streaming over JSON** — the chat endpoint uses SSE streaming so the UI feels responsive during multi-turn tool calls that can take several seconds.
