import { NextRequest, NextResponse } from "next/server";
import { searchNSMByCompany, searchNSMByLEI, searchNSMByContent } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode = searchParams.get("mode") ?? "company";
  const query = searchParams.get("query") ?? "";
  const lei = searchParams.get("lei") ?? "";
  const keywords = searchParams.get("keywords") ?? "";
  const matchMode = (searchParams.get("match_mode") ?? "any_word") as "exact_match" | "all_words" | "any_word";
  const source = searchParams.get("source") ?? undefined;
  const dateFrom = searchParams.get("date_from") ?? undefined;
  const dateTo = searchParams.get("date_to") ?? undefined;
  const pubDateFrom = searchParams.get("pub_date_from") ?? undefined;
  const pubDateTo = searchParams.get("pub_date_to") ?? undefined;

  // Prefer publication date range if provided, fall back to filing date range
  const resolvedDateFrom = pubDateFrom ?? dateFrom;
  const resolvedDateTo = pubDateTo ?? dateTo;

  try {
    let result: { total: number; filings: unknown[] };

    if (mode === "lei" && lei) {
      result = await searchNSMByLEI({
        lei,
        source,
        date_from: resolvedDateFrom,
        date_to: resolvedDateTo,
      });
    } else if (mode === "content" && keywords) {
      result = await searchNSMByContent({
        keywords,
        matchMode,
        source,
        date_from: resolvedDateFrom,
        date_to: resolvedDateTo,
      });
    } else if (query) {
      result = await searchNSMByCompany({
        company: query,
        source,
        date_from: resolvedDateFrom,
        date_to: resolvedDateTo,
      });
    } else {
      return NextResponse.json({ error: "At least one search parameter is required." }, { status: 400 });
    }

    return NextResponse.json({ results: result.filings, total: result.total });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
