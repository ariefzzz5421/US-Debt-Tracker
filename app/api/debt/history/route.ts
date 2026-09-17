import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 21_600;

const BASE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny";

const RANGE_YEARS = {
  "5Y": 5,
  "10Y": 10,
  "30Y": 30,
} as const;

type RangeKey = keyof typeof RANGE_YEARS | "MAX";

type RawDebtRecord = {
  record_date?: string;
  debt_held_public_amt?: string;
  intragov_hold_amt?: string;
  tot_pub_debt_out_amt?: string;
};

function toNumber(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rangeStart(range: RangeKey) {
  if (range === "MAX") return null;
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(date.getUTCFullYear() - RANGE_YEARS[range]);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("range")?.toUpperCase();
  const range: RangeKey =
    requested === "5Y" ||
    requested === "10Y" ||
    requested === "30Y" ||
    requested === "MAX"
      ? requested
      : "5Y";

  const params = new URLSearchParams({
    fields:
      "record_date,debt_held_public_amt,intragov_hold_amt,tot_pub_debt_out_amt",
    sort: "record_date",
    "page[size]": "10000",
  });
  const start = rangeStart(range);
  if (start) params.set("filter", `record_date:gte:${start}`);

  try {
    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "US-Debt-Tracker/1.0",
      },
      next: { revalidate: 21_600 },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(`Treasury API returned ${response.status}`);
    }

    const payload = (await response.json()) as { data?: RawDebtRecord[] };
    const records = (payload.data ?? [])
      .map((row) => ({
        recordDate: row.record_date ?? "",
        totalDebt: toNumber(row.tot_pub_debt_out_amt),
        debtHeldPublic: toNumber(row.debt_held_public_amt),
        intragovernmental: toNumber(row.intragov_hold_amt),
      }))
      .filter(
        (row): row is {
          recordDate: string;
          totalDebt: number;
          debtHeldPublic: number;
          intragovernmental: number;
        } =>
          Boolean(row.recordDate) &&
          row.totalDebt !== null &&
          row.debtHeldPublic !== null &&
          row.intragovernmental !== null,
      );

    if (records.length < 2) {
      throw new Error("Treasury API returned too few historical records");
    }

    return NextResponse.json(
      {
        status: "official",
        range,
        source: "U.S. Treasury Fiscal Data — Debt to the Penny",
        cadence: "Published after each U.S. business day",
        fetchedAt: new Date().toISOString(),
        records,
      },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=21600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (reason) {
    return NextResponse.json(
      {
        status: "unavailable",
        range,
        source: "U.S. Treasury Fiscal Data — Debt to the Penny",
        fetchedAt: new Date().toISOString(),
        records: [],
        notice:
          reason instanceof Error
            ? reason.message
            : "Long-range Treasury history is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
