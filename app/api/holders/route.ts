import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const FOREIGN_HOLDERS_URL =
  "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates";
const YAHOO_CHART_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart",
  "https://query2.finance.yahoo.com/v8/finance/chart",
];

type FxRange =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "1Y"
  | "2Y"
  | "5Y"
  | "10Y"
  | "MAX";

type CurrencyMeta = {
  code: string;
  name: string;
};

const COUNTRY_CURRENCY: Record<string, CurrencyMeta> = {
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

const COUNTRY_FLAG_PATHS: Record<string, string> = {
  Belgium: "/flags/be.png",
  Canada: "/flags/ca.png",
  "Cayman Islands": "/flags/ky.png",
  "China, Mainland": "/flags/cn.png",
  France: "/flags/fr.png",
  Ireland: "/flags/ie.png",
  Japan: "/flags/jp.png",
  Luxembourg: "/flags/lu.png",
  Taiwan: "/flags/tw.png",
  "United Kingdom": "/flags/gb.png",
};

const YAHOO_PAIR_OVERRIDES: Record<string, { symbol: string; invert: boolean }> = {
  EUR: { symbol: "EURUSD=X", invert: true },
  GBP: { symbol: "GBPUSD=X", invert: true },
};

const VALID_RANGES = new Set<FxRange>([
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "2Y",
  "5Y",
  "10Y",
  "MAX",
]);

const INTRADAY_RANGES = new Set<FxRange>(["1D", "5D"]);

type Holder = {
  rank: number;
  name: string;
  slug: string;
  value: number;
  previousValue: number;
  currency: CurrencyMeta | null;
  flagPath: string | null;
};

type FxRecord = {
  date: string;
  rate: number;
};

type FxRow = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  revalidateSeconds = 3600,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9",
        "User-Agent": "US-Debt-Tracker/1.2",
      },
      next: { revalidate: revalidateSeconds },
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
      flagPath: COUNTRY_FLAG_PATHS[row.name] ?? null,
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

function startForRange(range: FxRange) {
  if (range === "MAX") return "1999-01-04";

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  if (range === "1D") now.setUTCDate(now.getUTCDate() - 1);
  else if (range === "5D") now.setUTCDate(now.getUTCDate() - 5);
  else if (range === "1M") now.setUTCMonth(now.getUTCMonth() - 1);
  else if (range === "3M") now.setUTCMonth(now.getUTCMonth() - 3);
  else if (range === "6M") now.setUTCMonth(now.getUTCMonth() - 6);
  else if (range === "2Y") now.setUTCFullYear(now.getUTCFullYear() - 2);
  else if (range === "5Y") now.setUTCFullYear(now.getUTCFullYear() - 5);
  else if (range === "10Y") now.setUTCFullYear(now.getUTCFullYear() - 10);
  else now.setUTCFullYear(now.getUTCFullYear() - 1);
  return now.toISOString().slice(0, 10);
}

function yahooPair(code: string) {
  return YAHOO_PAIR_OVERRIDES[code] ?? { symbol: `${code}=X`, invert: false };
}

function normalizeYahooRate(value: number, invert: boolean) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const normalized = invert ? 1 / value : value;
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

async function fetchYahooPayload(
  symbol: string,
  query: string,
  revalidateSeconds: number,
) {
  let lastError = "Yahoo Finance FX feed is unavailable";

  for (const host of YAHOO_CHART_HOSTS) {
    const response = await fetchWithTimeout(
      `${host}/${encodeURIComponent(symbol)}?${query}`,
      9_000,
      revalidateSeconds,
    );
    if (!response.ok) {
      lastError = `Yahoo Finance returned ${response.status}`;
      continue;
    }

    const payload = (await response.json()) as YahooChartPayload;
    if (payload.chart?.result?.[0]) return payload.chart.result[0];
    lastError = "Yahoo Finance returned no FX chart result";
  }

  throw new Error(lastError);
}

async function fetchLiveFx(code: string) {
  const pair = yahooPair(code);
  const result = await fetchYahooPayload(
    pair.symbol,
    "range=1d&interval=5m&includePrePost=true",
    60,
  );
  const rawRate = Number(result.meta?.regularMarketPrice);
  const rate = normalizeYahooRate(rawRate, pair.invert);
  if (rate === null) throw new Error(`No live USD/${code} quote was returned`);

  const marketTime = Number(result.meta?.regularMarketTime);
  const asOf = Number.isFinite(marketTime)
    ? new Date(marketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    rate,
    asOf,
    source: "Yahoo Finance FX market quote",
  };
}

function yahooRangeConfig(range: FxRange) {
  const configs: Record<FxRange, { range: string; interval: string; revalidate: number }> = {
    "1D": { range: "1d", interval: "5m", revalidate: 60 },
    "5D": { range: "5d", interval: "30m", revalidate: 300 },
    "1M": { range: "1mo", interval: "1d", revalidate: 900 },
    "3M": { range: "3mo", interval: "1d", revalidate: 1800 },
    "6M": { range: "6mo", interval: "1d", revalidate: 1800 },
    "1Y": { range: "1y", interval: "1d", revalidate: 3600 },
    "2Y": { range: "2y", interval: "1wk", revalidate: 3600 },
    "5Y": { range: "5y", interval: "1wk", revalidate: 3600 },
    "10Y": { range: "10y", interval: "1mo", revalidate: 3600 },
    MAX: { range: "max", interval: "1mo", revalidate: 3600 },
  };
  return configs[range];
}

async function fetchYahooHistory(code: string, range: FxRange) {
  const pair = yahooPair(code);
  const config = yahooRangeConfig(range);
  const result = await fetchYahooPayload(
    pair.symbol,
    `range=${config.range}&interval=${config.interval}&includePrePost=false`,
    config.revalidate,
  );
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const records = timestamps
    .map((timestamp, index) => {
      const rawRate = Number(closes[index]);
      const rate = normalizeYahooRate(rawRate, pair.invert);
      if (rate === null) return null;
      const timestampDate = new Date(timestamp * 1000);
      return {
        date: INTRADAY_RANGES.has(range)
          ? timestampDate.toISOString()
          : timestampDate.toISOString().slice(0, 10),
        rate,
      };
    })
    .filter((row): row is FxRecord => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (records.length < 2) {
    throw new Error(`Not enough Yahoo USD/${code} observations`);
  }

  return records;
}

function dedupeRecords(records: FxRecord[]) {
  return Array.from(new Map(records.map((record) => [record.date, record])).values()).sort(
    (a, b) => a.date.localeCompare(b.date),
  );
}

async function fetchFrankfurterFx(code: string, range: FxRange) {
  if (INTRADAY_RANGES.has(range)) {
    throw new Error("Intraday range requires a market feed");
  }

  const params = new URLSearchParams({
    base: "USD",
    quotes: code,
    from: startForRange(range),
  });
  if (range === "1Y" || range === "2Y") params.set("group", "week");
  if (range === "5Y" || range === "10Y" || range === "MAX") {
    params.set("group", "month");
  }

  const response = await fetchWithTimeout(
    `${FRANKFURTER_URL}?${params.toString()}`,
    15_000,
  );
  if (!response.ok) {
    throw new Error(`Frankfurter returned ${response.status}`);
  }

  const rows = (await response.json()) as FxRow[];
  const records = dedupeRecords(
    rows
      .filter(
        (row) =>
          Boolean(row.date) &&
          row.quote?.toUpperCase() === code &&
          Number.isFinite(row.rate),
      )
      .map((row) => ({ date: row.date!, rate: Number(row.rate) })),
  );

  if (records.length < 2) {
    throw new Error(`Not enough Frankfurter USD/${code} observations`);
  }

  return records;
}

async function fetchFxHistory(code: string, range: FxRange) {
  if (INTRADAY_RANGES.has(range)) {
    return {
      records: await fetchYahooHistory(code, range),
      source: "Yahoo Finance historical FX chart",
      cadence: range === "1D" ? "5-minute market observations" : "30-minute market observations",
    };
  }

  try {
    return {
      records: await fetchFrankfurterFx(code, range),
      source: "Frankfurter — central-bank and official-source exchange-rate blend",
      cadence: "Reference rates; frequency varies by contributing provider",
    };
  } catch {
    return {
      records: await fetchYahooHistory(code, range),
      source: "Yahoo Finance historical FX chart",
      cadence: "Market-history observations; interval is reduced for long ranges",
    };
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug")?.toLowerCase() ?? null;
  const requestedRange = params.get("range")?.toUpperCase() as FxRange | undefined;
  const range: FxRange = requestedRange && VALID_RANGES.has(requestedRange) ? requestedRange : "1Y";

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
      const history = await fetchFxHistory(holder.currency.code, range);
      const lastHistorical = history.records.at(-1)!;
      const first = history.records[0];
      const live = await fetchLiveFx(holder.currency.code).catch(() => null);
      const latest = live?.rate ?? lastHistorical.rate;

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
            latest,
            liveStatus: live ? "live" : "reference",
            liveAsOf: live?.asOf ?? `${lastHistorical.date}T00:00:00.000Z`,
            liveSource: live?.source ?? history.source,
            changePercent: ((latest - first.rate) / first.rate) * 100,
            records: history.records,
            source: history.source,
            cadence: history.cadence,
          },
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
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
