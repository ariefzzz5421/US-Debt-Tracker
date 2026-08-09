import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const FISCAL_DATA_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,debt_held_public_amt,intragov_hold_amt,tot_pub_debt_out_amt&sort=-record_date&page%5Bsize%5D=400";
const TREASURY_MOBILE_URL = "https://www.treasurydirect.gov/mobile/";

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

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json, text/html;q=0.9",
        "User-Agent": "US-Debt-Tracker/1.0",
      },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFiscalData() {
  const response = await fetchWithTimeout(FISCAL_DATA_URL, 18_000);
  if (!response.ok) throw new Error(`Treasury API returned ${response.status}`);

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

  if (records.length < 2) throw new Error("Treasury API returned too few records");

  return {
    status: "official" as const,
    source: "U.S. Treasury Fiscal Data",
    fetchedAt: new Date().toISOString(),
    cadence: "Published after each U.S. business day",
    records,
  };
}

async function fetchTreasuryFallback() {
  const response = await fetchWithTimeout(TREASURY_MOBILE_URL, 8_000);
  if (!response.ok) throw new Error(`TreasuryDirect returned ${response.status}`);

  const text = (await response.text())
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const match = text.match(
    /As of:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})[\s\S]{0,500}?Public Debt Outstanding\s*\$([\d,]+(?:\.\d{2})?)/i,
  );
  if (!match) throw new Error("Could not read TreasuryDirect fallback");

  const recordDate = new Date(match[1]);
  const totalDebt = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(totalDebt) || Number.isNaN(recordDate.getTime())) {
    throw new Error("TreasuryDirect fallback contained invalid data");
  }

  return {
    status: "partial" as const,
    source: "U.S. TreasuryDirect",
    fetchedAt: new Date().toISOString(),
    cadence: "Published after each U.S. business day",
    records: [
      {
        recordDate: recordDate.toISOString().slice(0, 10),
        totalDebt,
        debtHeldPublic: null,
        intragovernmental: null,
      },
    ],
    notice: "Treasury Fiscal Data is temporarily slow. Showing the official total from TreasuryDirect; detailed history is unavailable.",
  };
}

export async function GET() {
  try {
    const data = await fetchFiscalData();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    try {
      const fallback = await fetchTreasuryFallback();
      return NextResponse.json(fallback, {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      });
    } catch {
      return NextResponse.json(
        {
          status: "unavailable",
          source: "U.S. Treasury",
          fetchedAt: new Date().toISOString(),
          records: [],
          notice: "The official Treasury source is not responding. No replacement number has been invented.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
}
