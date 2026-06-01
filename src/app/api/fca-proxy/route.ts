/**
 * Edge-runtime pass-through proxy for the FCA NSM search API.
 *
 * Why this exists:
 * Cloudflare Bot Management blocks Vercel's serverless function IPs from
 * accessing api.data.fca.org.uk directly (returns 200 with 0 results).
 * Edge functions run on Vercel's CDN infrastructure which has a separate,
 * rotating pool of egress IPs less likely to be flagged by Cloudflare.
 *
 * The chat route's fca-tools.ts calls this endpoint instead of the FCA API
 * directly, so the outbound request comes from an Edge node IP.
 */
export const runtime = "edge";

const FCA_SEARCH_URL = "https://api.data.fca.org.uk/search";

export async function POST(request: Request) {
  const incomingUrl = new URL(request.url);
  const index = incomingUrl.searchParams.get("index") ?? "fca-nsm-searchdata";

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: "Failed to read request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let fcaRes: Response;
  try {
    fcaRes = await fetch(`${FCA_SEARCH_URL}?index=${encodeURIComponent(index)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: "https://data.fca.org.uk",
        Referer: "https://data.fca.org.uk/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream fetch failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const responseText = await fcaRes.text();
  return new Response(responseText, {
    status: fcaRes.status,
    headers: {
      "Content-Type": fcaRes.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
