import { NextRequest, NextResponse } from "next/server";
import { searchFIRDS } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const isin = searchParams.get("isin") ?? undefined;
  const instrumentId = searchParams.get("instrument_id") ?? undefined;
  const issuerLei = searchParams.get("issuer_lei") ?? undefined;
  const classification = searchParams.get("classification") ?? undefined;
  const name = searchParams.get("name") ?? undefined;

  if (!isin && !instrumentId && !issuerLei && !classification && !name) {
    return NextResponse.json({ error: "Provide at least one of: isin, instrument_id, issuer_lei, classification, name" }, { status: 400 });
  }

  try {
    const results = await searchFIRDS({ isin, instrument_id: instrumentId, issuer_lei: issuerLei, classification, instrument_name: name });
    return NextResponse.json({ results, total: results.length });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}
