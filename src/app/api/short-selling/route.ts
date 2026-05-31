import { NextRequest, NextResponse } from "next/server";
import { getShortPositions } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  try {
    const results = await getShortPositions({
      issuer_name: searchParams.get("issuer") ?? undefined,
      above_threshold: searchParams.get("threshold") ? Number(searchParams.get("threshold")) : undefined,
    });
    return NextResponse.json({ results });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fetch failed" }, { status: 500 });
  }
}
