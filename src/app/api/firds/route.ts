import { NextRequest, NextResponse } from "next/server";
import { searchFIRDS } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  try {
    const results = await searchFIRDS({
      isin: searchParams.get("isin") ?? undefined,
      instrument_name: searchParams.get("name") ?? undefined,
    });
    return NextResponse.json({ results });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}
