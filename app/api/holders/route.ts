import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const FOREIGN_HOLDERS_URL =
  "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates";

const COUNTRY_CURRENCY: Record<string, { code: string; name: string }> = {
  Australia: { code: "AUD", name: "Australian Dollar" },
  Belgium: { code: "EUR", name: "Euro" },
  Brazil: { code: "BRL", name: "Brazilian Real" },
  Canada: { code: "CAD", name: "Canadian Dollar" },
  "Cayman Islands": { code: "KYD", name: "Cayman Islands Dollar" },
  "China, Mainland": { code: "CNY", name: "Chinese Yuan" },
  France: { code: "EUR", name: "Euro" },
  Germany: { code: "EUR", name: "Euro" },
  "Hong Kong": { code: "HKD", name: "Hong Kong Dollar" },
  India: { code: "INR", name: "Indian Rupee" },
  Ireland: { code: "EUR", name: "Euro" },
  Japan: { code: "JPY", name: "Japanese Yen" },
  Luxembourg: { code: "EUR", name: "Euro" },
  Mexico: { code: "MXN", name: "Mexican Peso" },
  Netherlands: { code: "EUR", name: "Euro" },
  Norway: { code: "NOK", name: "Norwegian Krone" },
  "Saudi Arabia": { code: "SAR", name: "Saudi Riyal" },
  Singapore: { code: "SGD", name: "Singapore Dollar" },
  "South Korea": { code: "KRW", name: "South Korean Won" },
  Switzerland: { code: "CHF", name: "Swiss Franc" },
  Taiwan: { code: "TWD", name: "New Taiwan Dollar" },
  "United Kingdom": { code: "GBP", name: "British Pound" },
};

type Holder = {
  rank: number;
  name: string;
  slug: string;
  value: number;
  previousValue: number;
  currency: { code: string; name: string } | null;
};

type FxRow = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9",
        "User-Agent": "US-Debt-Tracker/1.0",
      },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTopHolders() {
  const response = await fetchWithTimeout(FOREIGN_HOLDERS_URL, 15_000);
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

  const holders: Holder[] = rows
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
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      slug: slugify(row.name),
      currency: COUNTRY_CURRENCY[row.name] ?? null,
    }));

  const totalForeign = Number(totalRow?.[1]) * 1_000_000_000;
  if (!asOf || holders.length !== 10 || !Number.isFinite(totalForeign)) {
    throw new Error("Treasury TIC data was incomplete");
  }

  return {
    asOf,
    previousPeriod,
    totalForeign,
    holders,
  };
}

function startForRange(range: string) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  if (range === "1M") now.setUTCMonth(now.getUTCMonth() - 1);
  else if (range === "5Y") now.setUTCFullYear(now.getUTCFullYear() - 5);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString().slice(0, 10);
}

async function fetchFx(code: string, range: string) {
  const params = new URLSearchParams({
    base: "USD",
    quotes: code,
    from: startForRange(range),
  });
  if (range === "1Y") params.set("group", "week");
  if (range === "5Y") params.set("group", "month");

  const response = await fetchWithTimeout(
    `${FRANKFURTER_URL}?${params.toString()}`,
    15_000,
  );
  if (!response.ok) {
    throw new Error(`FX source returned ${response.status}`);
  }

  const rows = (await response.json()) as FxRow[];
  const records = rows
    .filter(
      (row) =>
        Boolean(row.date) &&
        row.quote?.toUpperCase() === code &&
        Number.isFinite(row.rate),
    )
    .map((row) => ({ date: row.date!, rate: Number(row.rate) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (records.length < 2) {
    throw new Error(`Not enough USD/${code} observations`);
  }

  return records;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug")?.toLowerCase() ?? null;
  const requestedRange = params.get("range")?.toUpperCase();
  const range =
    requestedRange === "1M" || requestedRange === "5Y" ? requestedRange : "1Y";

  try {
    const data = await fetchTopHolders();

    if (!slug) {
      return NextResponse.json(
        {
          status: "official",
          source: "U.S. Treasury International Capital (TIC)",
          cadence: "Monthly, published with a reporting lag",
          fetchedAt: new Date().toISOString(),
          ...data,
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        },
      );
    }

    const holder = data.holders.find((item) => item.slug === slug);
    if (!holder) {
      return NextResponse.json(
        {
          status: "not-found",
          notice: "That country is not in the current Treasury top-10 foreign-holder table.",
          top10: data.holders,
        },
        { status: 404 },
      );
    }

    if (!holder.currency) {
      return NextResponse.json({
        status: "official",
        source: "U.S. Treasury International Capital (TIC)",
        fetchedAt: new Date().toISOString(),
        asOf: data.asOf,
        previousPeriod: data.previousPeriod,
        holder,
        fx: {
          status: "unavailable",
          notice: "No currency mapping is configured for this holder yet.",
        },
      });
    }

    try {
      const records = await fetchFx(holder.currency.code, range);
      const latest = records.at(-1)!;
      const first = records[0];
      return NextResponse.json(
        {
          status: "official",
          source: "U.S. Treasury International Capital (TIC)",
          fetchedAt: new Date().toISOString(),
          asOf: data.asOf,
          previousPeriod: data.previousPeriod,
          holder,
          fx: {
            status: "available",
            pair: `USD/${holder.currency.code}`,
            currencyName: holder.currency.name,
            range,
            latest: latest.rate,
            changePercent: ((latest.rate - first.rate) / first.rate) * 100,
            records,
            source:
              "Frankfurter — central-bank and official-source exchange-rate blend",
            cadence: "Reference rates; frequency varies by contributing provider",
          },
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
          },
        },
      );
    } catch (reason) {
      return NextResponse.json({
        status: "official",
        source: "U.S. Treasury International Capital (TIC)",
        fetchedAt: new Date().toISOString(),
        asOf: data.asOf,
        previousPeriod: data.previousPeriod,
        holder,
        fx: {
          status: "unavailable",
          pair: `USD/${holder.currency.code}`,
          notice:
            reason instanceof Error
              ? reason.message
              : "FX history is temporarily unavailable.",
        },
      });
    }
  } catch (reason) {
    return NextResponse.json(
      {
        status: "unavailable",
        source: "U.S. Treasury International Capital (TIC)",
        fetchedAt: new Date().toISOString(),
        notice:
          reason instanceof Error
            ? reason.message
            : "The official Treasury holder table is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
