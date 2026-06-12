import { NextRequest, NextResponse } from "next/server";
import { searchFITRS } from "@/lib/fca-tools";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from") ?? undefined;
  const dateTo = searchParams.get("date_to") ?? undefined;
  const fileType = searchParams.get("file_type") as "Full" | "Delta" | undefined ?? undefined;
  const keyword = searchParams.get("keyword") ?? undefined;

  try {
    const result = await searchFITRS({ date_from: dateFrom, date_to: dateTo, file_type: fileType, keyword });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
