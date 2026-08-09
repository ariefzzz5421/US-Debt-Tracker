import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const FISCAL_DATA_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,debt_held_public_amt,intragov_hold_amt,tot_pub_debt_out_amt&sort=-record_date&page%5Bsize%5D=400";
const TREASURY_MOBILE_URL = "https://www.treasurydirect.gov/mobile/";
const FOREIGN_HOLDERS_URL =
  "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt";
const REAL_YIELD_URL = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${new Date().getUTCFullYear()}`;

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

async function fetchForeignHolders() {
  const response = await fetchWithTimeout(FOREIGN_HOLDERS_URL, 12_000);
  if (!response.ok) throw new Error(`Treasury TIC returned ${response.status}`);

  const lines = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.startsWith("Country\t"));
  if (headerIndex < 0) throw new Error("Treasury TIC header was not found");

  const header = lines[headerIndex].split("\t");
  const asOf = header[1];
  const previousPeriod = header[2];
  const rows = lines.slice(headerIndex + 1).map((line) => line.split("\t"));
  const totalRow = rows.find((row) => row[0] === "Grand Total");
  const excluded = new Set([
    "All Other",
    "Grand Total",
    "Of Which: Foreign Official",
    "Of Which: Foreign Official Treasury Bills",
    "Of Which: Foreign Official T-Bonds & Notes",
  ]);

  const countries = rows
    .filter((row) => row.length >= 3 && !excluded.has(row[0]))
    .map((row) => ({
      name: row[0],
      value: Number(row[1]) * 1_000_000_000,
      previousValue: Number(row[2]) * 1_000_000_000,
    }))
    .filter(
      (row) => Number.isFinite(row.value) && Number.isFinite(row.previousValue),
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const totalForeign = Number(totalRow?.[1]) * 1_000_000_000;
  if (!asOf || countries.length !== 10 || !Number.isFinite(totalForeign)) {
    throw new Error("Treasury TIC data was incomplete");
  }

  return {
    status: "official" as const,
    asOf,
    previousPeriod,
    totalForeign,
    unit: "USD" as const,
    countries,
    source: "U.S. Treasury International Capital (TIC)",
    cadence: "Monthly, published with a reporting lag",
  };
}

function xmlValue(entry: string, field: string) {
  const match = entry.match(
    new RegExp(`<d:${field}[^>]*>([^<]+)<\\/d:${field}>`, "i"),
  );
  return match?.[1] ?? null;
}

async function fetchRealYields() {
  const response = await fetchWithTimeout(REAL_YIELD_URL, 12_000);
  if (!response.ok) throw new Error(`Treasury real-yield feed returned ${response.status}`);

  const xml = await response.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
  const observations = entries
    .map((entry) => {
      const date = xmlValue(entry, "NEW_DATE")?.slice(0, 10) ?? "";
      const fiveYear = Number(xmlValue(entry, "TC_5YEAR"));
      const sevenYear = Number(xmlValue(entry, "TC_7YEAR"));
      const tenYear = Number(xmlValue(entry, "TC_10YEAR"));
      const twentyYear = Number(xmlValue(entry, "TC_20YEAR"));
      const thirtyYear = Number(xmlValue(entry, "TC_30YEAR"));
      return { date, fiveYear, sevenYear, tenYear, twentyYear, thirtyYear };
    })
    .filter(
      (row) =>
        Boolean(row.date) &&
        [row.fiveYear, row.sevenYear, row.tenYear, row.twentyYear, row.thirtyYear].every(
          Number.isFinite,
        ),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  if (observations.length < 2) throw new Error("Treasury real-yield feed was incomplete");
  const latest = observations[0];
  const previous = observations[1];

  return {
    status: "official" as const,
    asOf: latest.date,
    tenYear: latest.tenYear,
    tenYearDailyChangeBps: Math.round((latest.tenYear - previous.tenYear) * 100),
    curve: [
      { tenor: "5Y", value: latest.fiveYear },
      { tenor: "7Y", value: latest.sevenYear },
      { tenor: "10Y", value: latest.tenYear },
      { tenor: "20Y", value: latest.twentyYear },
      { tenor: "30Y", value: latest.thirtyYear },
    ],
    source: "U.S. Treasury Daily Par Real Yield Curve Rates",
    cadence: "Daily on U.S. business days",
  };
}

export async function GET() {
  const [holdersResult, realYieldResult] = await Promise.allSettled([
    fetchForeignHolders(),
    fetchRealYields(),
  ]);
  const supplemental = {
    foreignHolders:
      holdersResult.status === "fulfilled"
        ? holdersResult.value
        : {
            status: "unavailable" as const,
            source: "U.S. Treasury International Capital (TIC)",
            notice: "The official monthly foreign-holdings table is temporarily unavailable.",
          },
    realYields:
      realYieldResult.status === "fulfilled"
        ? realYieldResult.value
        : {
            status: "unavailable" as const,
            source: "U.S. Treasury Daily Par Real Yield Curve Rates",
            notice: "The official daily real-yield feed is temporarily unavailable.",
          },
  };

  try {
    const data = await fetchFiscalData();
    return NextResponse.json({ ...data, ...supplemental }, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    try {
      const fallback = await fetchTreasuryFallback();
      return NextResponse.json({ ...fallback, ...supplemental }, {
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
          ...supplemental,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
}
