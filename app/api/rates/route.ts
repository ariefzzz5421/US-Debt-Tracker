import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 900;

const EFFR_URL =
  "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/120.json";

 type RawRate = {
  effectiveDate?: string;
  type?: string;
  percentRate?: number;
};

export async function GET() {
  try {
    const response = await fetch(EFFR_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "US-Debt-Tracker/1.0",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`New York Fed API returned ${response.status}`);
    }

    const payload = (await response.json()) as { refRates?: RawRate[] };
    const records = (payload.refRates ?? [])
      .filter(
        (row) =>
          row.type === "EFFR" &&
          Boolean(row.effectiveDate) &&
          Number.isFinite(row.percentRate),
      )
      .map((row) => ({
        date: row.effectiveDate!,
        rate: Number(row.percentRate),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (records.length < 2) {
      throw new Error("New York Fed returned too few EFFR observations");
    }

    const latest = records.at(-1)!;
    const previous = records.at(-2)!;

    return NextResponse.json(
      {
        status: "official",
        source: "Federal Reserve Bank of New York — Effective Federal Funds Rate",
        cadence: "Published each U.S. business day for the prior business day",
        fetchedAt: new Date().toISOString(),
        asOf: latest.date,
        latest: latest.rate,
        dailyChangeBps: Math.round((latest.rate - previous.rate) * 100),
        records,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch (reason) {
    return NextResponse.json(
      {
        status: "unavailable",
        source: "Federal Reserve Bank of New York — EFFR",
        fetchedAt: new Date().toISOString(),
        records: [],
        notice:
          reason instanceof Error
            ? reason.message
            : "The official EFFR feed is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
