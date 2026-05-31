import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
} from "@google/generative-ai";
import { searchNSMByCompany, searchNSMByLEI, searchNSMByContent, fetchPDFSummary, searchFIRDS, searchFITRS, getShortPositions } from "@/lib/fca-tools";

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

const SYSTEM_PROMPT = `You are a data assistant for the FCA Data Portal (data.fca.org.uk).
You help users find and understand public regulatory data across:
- NSM (National Storage Mechanism): company filings, annual reports, prospectuses, circulars, RNS announcements
- UK FIRDS: financial instrument reference data (ISINs, CFI codes, MIC codes)
- UK FITRS: MiFID II transparency calculations (liquidity, LIS/SSTI thresholds)
- Short Selling Register: net short position disclosures

NSM search strategy — choose the right tool:
- "Show me Barclays filings" / "What has HSBC filed?" → use search_nsm_by_company
- You have an exact LEI code (20 chars, e.g. 213800LBQA1Y9L22JB70) → use search_nsm_by_lei (more precise, no name-match noise)
- "Find documents mentioning climate risk" / topic/keyword search → use search_nsm_by_content
- When a user provides a company name and you want maximum precision, you can try search_nsm_by_company first, note the total count, then use search_nsm_by_lei if the user provides or asks about the LEI.

Rules:
1. Always retrieve data using your tools — never invent or guess values.
2. Always cite the source: include the record URL or document link when available.
3. Format results clearly using markdown tables or bullet points.
4. When showing NSM results, include: headline, filing type, company, date, and a clickable link.
5. If data is unavailable or the query is out of scope, say so clearly.
6. Be concise: lead with the direct answer, then provide supporting detail.
7. Mention the total number of matching records when returning NSM results (e.g. "Found 19,985 filings — showing the 50 most recent").
8. Never provide investment, legal, or regulatory advice.`;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromDesc() {
  return `Optional start date in YYYY-MM-DD format. Infer from relative phrases — e.g. "this week" → 7 days ago, "last month" → start of last calendar month, "this year" → ${new Date().getFullYear()}-01-01, "since March" → ${new Date().getFullYear()}-03-01. Today is ${todayStr()}.`;
}

function dateToDesc() {
  return `Optional end date in YYYY-MM-DD format. Defaults to today (${todayStr()}) if omitted. Infer from phrases like "before April", "up to last Friday", "end of Q1".`;
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_nsm_by_company",
    description: `Search NSM (National Storage Mechanism) for filings made by or related to a specific company.
Use this when the user asks about a company's filings, disclosures, or announcements — e.g. "show me Barclays filings", "what has HSBC submitted recently?", "find prospectuses by Lloyds".
Returns: a list of matching disclosures with headline, filing type, date, and document link.
The total count of matched records is also returned — mention it if the user asks how many filings exist.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        company: {
          type: SchemaType.STRING,
          description: "Company name to search for (e.g. 'Barclays', 'HSBC', 'Shell'). Do not pass a LEI code here — use search_nsm_by_lei for that.",
        },
        filing_type: {
          type: SchemaType.STRING,
          description: "Optional filing type filter. Accepted values: 'Annual Report', 'Prospectus', 'Circular', 'Holding(s) in Company', 'Form 8.3', 'Form 8.5', 'Admission to Trading', 'Final Terms', 'Supplementary Prospectus', 'Irish Takeover', 'Net Asset Value', 'Miscellaneous'.",
        },
        date_from: { type: SchemaType.STRING, description: dateFromDesc() },
        date_to: { type: SchemaType.STRING, description: dateToDesc() },
        page: { type: SchemaType.NUMBER, description: "Optional page number for pagination (0-indexed, each page returns 50 results)" },
      },
      required: ["company"],
    },
  },
  {
    name: "search_nsm_by_lei",
    description: `Search NSM using a precise LEI (Legal Entity Identifier) code.
Use this when the user provides a LEI directly, or when you have resolved a company name to a LEI in a prior step and want exact results without text-match noise.
A LEI-based search is always more precise than a name search — prefer it when the LEI is known.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lei: {
          type: SchemaType.STRING,
          description: "The 20-character LEI code, e.g. '213800LBQA1Y9L22JB70'",
        },
        filing_type: {
          type: SchemaType.STRING,
          description: "Optional filing type filter (same values as search_nsm_by_company).",
        },
        date_from: { type: SchemaType.STRING, description: dateFromDesc() },
        date_to: { type: SchemaType.STRING, description: dateToDesc() },
        page: { type: SchemaType.NUMBER, description: "Optional page number (0-indexed)" },
      },
      required: ["lei"],
    },
  },
  {
    name: "search_nsm_by_content",
    description: `Search NSM for filings whose document body contains specific keywords or phrases.
Use this when the user asks about a topic or concept rather than a specific company — e.g. "find documents mentioning climate risk", "search for filings about remuneration policy", "show prospectuses containing the word 'restructuring'".
Do NOT use this to find a company's own filings — use search_nsm_by_company for that.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        keywords: {
          type: SchemaType.STRING,
          description: "Keywords or phrase to search for inside document content",
        },
        filing_type: {
          type: SchemaType.STRING,
          description: "Optional filing type filter (same values as search_nsm_by_company).",
        },
        date_from: { type: SchemaType.STRING, description: dateFromDesc() },
        date_to: { type: SchemaType.STRING, description: dateToDesc() },
        page: { type: SchemaType.NUMBER, description: "Optional page number (0-indexed)" },
      },
      required: ["keywords"],
    },
  },
  {
    name: "fetch_pdf_summary",
    description: "Fetch and extract text content from a publicly accessible NSM PDF document for summarisation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: { type: SchemaType.STRING, description: "The public URL of the PDF document" },
        extraction_prompt: { type: SchemaType.STRING, description: "What to extract — e.g. 'key risks', 'revenue and profit figures'" },
      },
      required: ["url", "extraction_prompt"],
    },
  },
  {
    name: "search_firds",
    description: "Search UK FIRDS for financial instrument reference data. Returns instrument details, CFI code, MIC, and MiFIR reportability.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        isin: { type: SchemaType.STRING, description: "ISIN code (e.g. GB0002875804)" },
        instrument_name: { type: SchemaType.STRING, description: "Optional: partial instrument or company name" },
        mic: { type: SchemaType.STRING, description: "Optional: market identifier code" },
      },
    },
  },
  {
    name: "search_fitrs",
    description: "Look up MiFID II transparency data from UK FITRS for an instrument — liquidity classification, LIS threshold, SSTI threshold.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        isin: { type: SchemaType.STRING, description: "ISIN code to look up" },
      },
      required: ["isin"],
    },
  },
  {
    name: "get_short_positions",
    description: "Query the FCA Short Selling Register for disclosed net short positions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        issuer_name: { type: SchemaType.STRING, description: "Optional: company or issuer name to filter by" },
        above_threshold: { type: SchemaType.NUMBER, description: "Optional: only return positions at or above this % (e.g. 0.5)" },
      },
    },
  },
];

// Rate limiting
const requestCounts = new Map<string, { count: number; reset: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.reset) {
    requestCounts.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a minute and try again." }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured. Add it to .env.local." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { messages: { role: string; content: string }[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const { messages } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(text: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      }

      try {
        const model = genai.getGenerativeModel({
          model: "gemini-flash-latest",
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        });

        // Convert message history to Gemini Content format
        const history: Content[] = messages.slice(0, -1).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

        const lastMessage = messages[messages.length - 1];
        const chat = model.startChat({ history });

        // Agentic loop — Gemini may request multiple tool calls
        let currentMessage = lastMessage.content;
        for (let turn = 0; turn < 5; turn++) {
          const result = await chat.sendMessage(currentMessage);
          const response = result.response;

          const functionCalls = response.functionCalls();
          if (functionCalls && functionCalls.length > 0) {
            // Execute all requested tool calls
            const toolResults = await Promise.all(
              functionCalls.map(async (fc) => {
                let output: unknown;
                try {
                  output = await executeTool(fc.name, fc.args as Record<string, unknown>);
                } catch (err) {
                  output = { error: err instanceof Error ? err.message : "Tool execution failed" };
                }
                return {
                  functionResponse: {
                    name: fc.name,
                    response: { result: JSON.stringify(output) },
                  },
                };
              })
            );

            // Feed tool results back as a new turn
            currentMessage = toolResults as unknown as string;
            continue;
          }

          // Stream the final text response word by word
          const text = response.text();
          if (text) {
            const words = text.split(/(\s+)/);
            for (const chunk of words) {
              send(chunk);
              await new Promise((r) => setTimeout(r, 10));
            }
          }
          break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        send(`\n\nError: ${msg}`);
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_nsm_by_company":
      return searchNSMByCompany({
        company: String(input.company ?? ""),
        filing_type: input.filing_type ? String(input.filing_type) : undefined,
        date_from: input.date_from ? String(input.date_from) : undefined,
        date_to: input.date_to ? String(input.date_to) : undefined,
        page: input.page !== undefined ? Number(input.page) : undefined,
      });
    case "search_nsm_by_lei":
      return searchNSMByLEI({
        lei: String(input.lei ?? ""),
        filing_type: input.filing_type ? String(input.filing_type) : undefined,
        date_from: input.date_from ? String(input.date_from) : undefined,
        date_to: input.date_to ? String(input.date_to) : undefined,
        page: input.page !== undefined ? Number(input.page) : undefined,
      });
    case "search_nsm_by_content":
      return searchNSMByContent({
        keywords: String(input.keywords ?? ""),
        filing_type: input.filing_type ? String(input.filing_type) : undefined,
        date_from: input.date_from ? String(input.date_from) : undefined,
        date_to: input.date_to ? String(input.date_to) : undefined,
        page: input.page !== undefined ? Number(input.page) : undefined,
      });
    case "fetch_pdf_summary":
      return fetchPDFSummary(String(input.url ?? ""));
    case "search_firds":
      return searchFIRDS({
        isin: input.isin ? String(input.isin) : undefined,
        instrument_name: input.instrument_name ? String(input.instrument_name) : undefined,
        mic: input.mic ? String(input.mic) : undefined,
      });
    case "search_fitrs":
      return searchFITRS(String(input.isin ?? ""));
    case "get_short_positions":
      return getShortPositions({
        issuer_name: input.issuer_name ? String(input.issuer_name) : undefined,
        above_threshold: input.above_threshold !== undefined ? Number(input.above_threshold) : undefined,
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
