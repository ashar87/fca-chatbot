import { NextRequest, NextResponse } from "next/server";
import { searchFITRS } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const isin = searchParams.get("isin") ?? "";
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });
  try {
    const result = await searchFITRS(isin);
    return NextResponse.json({ result });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}
