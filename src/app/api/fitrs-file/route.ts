import { NextRequest, NextResponse } from "next/server";
import { unzipSync } from "fflate";

export interface FITRSInstrumentRecord {
  techRecordId: string;
  isin: string;
  classification: string;
  fullName: string;
  liquid: boolean;
  methodology: string;
  reportingPeriodFrom: string;
  reportingPeriodTo: string;
  avgDailyTurnover: string;
  avgDailyTurnoverCcy: string;
  largeInScale: string;
  avgDailyTxCount: string;
  relevantMarket: string;
  relevantMarketAvgDailyTxCount: string;
}

function getText(el: Element, tag: string): string {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

function parseXML(xmlText: string): FITRSInstrumentRecord[] {
  // Use regex-based extraction to avoid needing a DOM parser in Node.js
  const records: FITRSInstrumentRecord[] = [];

  // Extract each <EqtyTrnsprncyData> block
  const blockRegex = /<EqtyTrnsprncyData>([\s\S]*?)<\/EqtyTrnsprncyData>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(xmlText)) !== null) {
    const block = match[1];

    const get = (tag: string): string => {
      const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)<\/${tag}>`).exec(block);
      return m?.[1]?.trim() ?? "";
    };

    const getAttr = (tag: string, attr: string): string => {
      const m = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"[^>]*>`).exec(block);
      return m?.[1]?.trim() ?? "";
    };

    // Reporting period — may be absent (ESTM) or present (FFWK/YEAR)
    const rptgPeriodMatch = /<RptgPrd>[\s\S]*?<FrDt>([^<]*)<\/FrDt>[\s\S]*?<ToDt>([^<]*)<\/ToDt>[\s\S]*?<\/RptgPrd>/.exec(block);

    // Relevant market avg daily tx — inside <RlvntMkt>
    const rlvntMktMatch = /<RlvntMkt>([\s\S]*?)<\/RlvntMkt>/.exec(block);
    const rlvntAvg = rlvntMktMatch
      ? (/<AvrgDalyNbOfTxs>([^<]*)<\/AvrgDalyNbOfTxs>/.exec(rlvntMktMatch[1])?.[1]?.trim() ?? "")
      : "";

    records.push({
      techRecordId: get("TechRcrdId"),
      isin: get("Id"),
      classification: get("FinInstrmClssfctn"),
      fullName: get("FullNm"),
      liquid: get("Lqdty") === "true",
      methodology: get("Mthdlgy"),
      reportingPeriodFrom: rptgPeriodMatch?.[1] ?? "",
      reportingPeriodTo: rptgPeriodMatch?.[2] ?? "",
      avgDailyTurnover: get("AvrgDalyTrnvr"),
      avgDailyTurnoverCcy: getAttr("AvrgDalyTrnvr", "Ccy"),
      largeInScale: get("LrgInScale"),
      avgDailyTxCount: get("AvrgDalyNbOfTxs"),
      relevantMarket: get("Id"),  // first <Id> in block is the ISIN; need to scope to RlvntMkt
      relevantMarketAvgDailyTxCount: rlvntAvg,
    });

    // Fix relevantMarket — re-extract scoped to <RlvntMkt>
    if (rlvntMktMatch) {
      const mktId = /<Id>([^<]*)<\/Id>/.exec(rlvntMktMatch[1])?.[1]?.trim() ?? "";
      records[records.length - 1].relevantMarket = mktId;
    }
  }

  return records;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  // Only allow FCA artefact URLs
  if (!url.startsWith("https://data.fca.org.uk/artefacts/FITRS/")) {
    return NextResponse.json({ error: "Only FCA FITRS artefact URLs are permitted" }, { status: 400 });
  }

  let zipBuffer: ArrayBuffer;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "FCA-Demo-Bot/1.0" } });
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to download file: HTTP ${res.status}` }, { status: 502 });
    }
    zipBuffer = await res.arrayBuffer();
  } catch (err) {
    return NextResponse.json({ error: `Download failed: ${(err as Error).message}` }, { status: 502 });
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zipBuffer));
  } catch (err) {
    return NextResponse.json({ error: `ZIP extraction failed: ${(err as Error).message}` }, { status: 500 });
  }

  const xmlEntries = Object.entries(files).filter(([name]) => name.toLowerCase().endsWith(".xml"));
  if (xmlEntries.length === 0) {
    return NextResponse.json({ error: "No XML files found in ZIP" }, { status: 500 });
  }

  const allRecords: FITRSInstrumentRecord[] = [];
  for (const [, bytes] of xmlEntries) {
    const xmlText = new TextDecoder("utf-8").decode(bytes);
    allRecords.push(...parseXML(xmlText));
  }

  console.log("[fitrs-file] parsed url=%s records=%d", url, allRecords.length);

  return NextResponse.json({ total: allRecords.length, records: allRecords });
}
