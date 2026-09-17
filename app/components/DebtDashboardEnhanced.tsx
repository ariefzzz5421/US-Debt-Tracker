"use client";

import Image from "next/image";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type DebtRecord = {
  recordDate: string;
  totalDebt: number;
  debtHeldPublic: number | null;
  intragovernmental: number | null;
};

type DebtPayload = {
  status: "official" | "partial" | "unavailable";
  source: string;
  fetchedAt: string;
  cadence?: string;
  notice?: string;
  records: DebtRecord[];
  foreignHolders?:
    | {
        status: "official";
        asOf: string;
        previousPeriod: string;
        totalForeign: number;
        unit: "USD";
        source: string;
        cadence: string;
        countries: Array<{
          rank: number;
          name: string;
          value: number;
          previousValue: number;
        }>;
      }
    | { status: "unavailable"; source: string; notice: string };
  realYields?:
    | {
        status: "official";
        asOf: string;
        tenYear: number;
        tenYearDailyChangeBps: number;
        source: string;
        cadence: string;
        curve: Array<{ tenor: string; value: number }>;
      }
    | { status: "unavailable"; source: string; notice: string };
};

type RatePayload =
  | {
      status: "official";
      source: string;
      cadence: string;
      fetchedAt: string;
      asOf: string;
      latest: number;
      dailyChangeBps: number;
      records: Array<{ date: string; rate: number }>;
    }
  | {
      status: "unavailable";
      source: string;
      fetchedAt: string;
      records: [];
      notice: string;
    };

type HistoryPayload = {
  status: "official" | "unavailable";
  range: string;
  records: DebtRecord[];
  notice?: string;
};

type RangeKey = "30D" | "90D" | "1Y" | "5Y" | "10Y" | "30Y" | "MAX";

type ChartStyle = CSSProperties & { "--active-position": string };

const U_S_POPULATION_JAN_2026 = 342_278_051;
const SECONDS_PER_DAY = 86_400;
const FISCAL_SOURCE =
  "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";
const CENSUS_SOURCE =
  "https://www.census.gov/popclock/embed.php?component=pop_on_date&date=20260101";
const TIC_SOURCE =
  "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.html";
const REAL_YIELD_SOURCE =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve";
const EFFR_SOURCE = "https://www.newyorkfed.org/markets/reference-rates/effr";
const LONG_RANGES = new Set<RangeKey>(["5Y", "10Y", "30Y", "MAX"]);
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatMoney(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedMoney(value: number) {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatCompactMoney(Math.abs(value))}`;
}

function formatBillions(value: number) {
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 1_000_000_000)}B`;
}

function formatTrillions(value: number) {
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value / 1_000_000_000_000)}T`;
}

function periodLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function differenceFrom(records: DebtRecord[], days: number) {
  if (records.length < 2) return null;
  const newest = records[0];
  const targetTime =
    new Date(`${newest.recordDate}T00:00:00Z`).getTime() - days * SECONDS_PER_DAY * 1000;
  const comparison = records.find(
    (record) => new Date(`${record.recordDate}T00:00:00Z`).getTime() <= targetTime,
  );
  return comparison ? newest.totalDebt - comparison.totalDebt : null;
}

function calculateRate(records: DebtRecord[]) {
  if (records.length < 2) return 0;
  const newest = records[0];
  const comparison = records[Math.min(29, records.length - 1)];
  const elapsed =
    new Date(`${newest.recordDate}T00:00:00Z`).getTime() -
    new Date(`${comparison.recordDate}T00:00:00Z`).getTime();
  if (elapsed <= 0) return 0;
  return (newest.totalDebt - comparison.totalDebt) / (elapsed / 1000);
}

function shortRangeRecords(records: DebtRecord[], range: RangeKey) {
  const newest = records[0];
  if (!newest) return [];
  const days = range === "30D" ? 30 : range === "90D" ? 90 : 365;
  const newestTime = new Date(`${newest.recordDate}T00:00:00Z`).getTime();
  const cutoff = newestTime - days * SECONDS_PER_DAY * 1000;
  return records
    .filter(
      (record) => new Date(`${record.recordDate}T00:00:00Z`).getTime() >= cutoff,
    )
    .reverse();
}

function linePoints(records: Array<{ rate: number }>) {
  if (records.length < 2) return "";
  const values = records.map((record) => record.rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return records
    .map((record, index) => {
      const x = (index / (records.length - 1)) * 100;
      const y = 28 - ((record.rate - min) / spread) * 24;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function DebtDashboardEnhanced() {
  const [payload, setPayload] = useState<DebtPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [showEstimate, setShowEstimate] = useState(true);
  const [range, setRange] = useState<RangeKey>("90D");
  const [historyRecords, setHistoryRecords] = useState<DebtRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chartPointIndex, setChartPointIndex] = useState<number | null>(null);
  const [chartDragging, setChartDragging] = useState(false);
  const [ratePayload, setRatePayload] = useState<RatePayload | null>(null);

  const loadDebt = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/debt", {
        cache: "no-store",
        signal: AbortSignal.timeout(32_000),
      });
      const data = (await response.json()) as DebtPayload;
      if (!response.ok || data.records.length === 0) {
        throw new Error(data.notice ?? "Official Treasury data is unavailable.");
      }
      setPayload(data);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Official Treasury data is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRate = useCallback(async () => {
    try {
      const response = await fetch("/api/rates", { cache: "no-store" });
      const data = (await response.json()) as RatePayload;
      setRatePayload(data);
    } catch {
      setRatePayload(null);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadDebt();
      void loadRate();
    }, 0);
    const rateRefresh = window.setInterval(() => void loadRate(), 15 * 60 * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(rateRefresh);
    };
  }, [loadDebt, loadRate]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!LONG_RANGES.has(range)) {
      setHistoryRecords(null);
      setHistoryError(null);
      return;
    }

    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    setChartPointIndex(null);

    fetch(`/api/debt/history?range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as HistoryPayload;
        if (!response.ok || data.records.length < 2) {
          throw new Error(data.notice ?? "Long-range history is unavailable.");
        }
        setHistoryRecords(data.records);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setHistoryError(
          reason instanceof Error ? reason.message : "Long-range history is unavailable.",
        );
      })
      .finally(() => setHistoryLoading(false));

    return () => controller.abort();
  }, [range]);

  const stats = useMemo(() => {
    const records = payload?.records ?? [];
    const latest = records[0] ?? null;
    const previous = records[1] ?? null;
    const perSecond = calculateRate(records);
    const officialTotal = latest?.totalDebt ?? 0;
    const recordTime = latest
      ? new Date(`${latest.recordDate}T23:59:59Z`).getTime()
      : clock;
    const elapsedSinceRecord = Math.max(
      0,
      Math.min((clock - recordTime) / 1000, SECONDS_PER_DAY * 4),
    );
    const estimatedTotal = officialTotal + perSecond * elapsedSinceRecord;

    return {
      latest,
      previous,
      perSecond,
      officialTotal,
      estimatedTotal,
      dailyChange:
        latest && previous ? latest.totalDebt - previous.totalDebt : null,
      monthlyChange: differenceFrom(records, 30),
      yearlyChange: differenceFrom(records, 365),
    };
  }, [payload, clock]);

  const chartRecords = useMemo(() => {
    if (LONG_RANGES.has(range)) return historyRecords ?? [];
    return shortRangeRecords([...(payload?.records ?? [])], range);
  }, [payload, range, historyRecords]);

  const chart = useMemo(() => {
    if (chartRecords.length < 2) return [];
    const maxPoints = 120;
    const stride = Math.max(1, Math.ceil(chartRecords.length / maxPoints));
    const sampled = chartRecords.filter(
      (_, index) => index % stride === 0 || index === chartRecords.length - 1,
    );
    const values = sampled.map((record) => record.totalDebt);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    return sampled.map((record) => ({
      ...record,
      height: 12 + ((record.totalDebt - min) / spread) * 88,
    }));
  }, [chartRecords]);

  const publicShare =
    stats.latest?.debtHeldPublic && stats.latest.totalDebt
      ? (stats.latest.debtHeldPublic / stats.latest.totalDebt) * 100
      : null;
  const displayedTotal = showEstimate ? stats.estimatedTotal : stats.officialTotal;
  const holders = payload?.foreignHolders;
  const realYields = payload?.realYields;
  const largestHolding =
    holders?.status === "official" ? holders.countries[0]?.value ?? 1 : 1;
  const activeChartIndex =
    chart.length > 0
      ? Math.min(chartPointIndex ?? chart.length - 1, chart.length - 1)
      : -1;
  const activeChartPoint = activeChartIndex >= 0 ? chart[activeChartIndex] : null;
  const activeChartPrevious = activeChartIndex > 0 ? chart[activeChartIndex - 1] : null;
  const activeChartChange =
    activeChartPoint && activeChartPrevious
      ? activeChartPoint.totalDebt - activeChartPrevious.totalDebt
      : null;
  const chartStyle = {
    "--active-position": `${
      chart.length > 1 ? (activeChartIndex / (chart.length - 1)) * 100 : 100
    }%`,
  } as ChartStyle;
  const effr = ratePayload?.status === "official" ? ratePayload : null;
  const effrPoints = linePoints(effr?.records ?? []);

  const updateChartPoint = (clientX: number, element: HTMLDivElement) => {
    if (chart.length < 2) return;
    const bounds = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    setChartPointIndex(Math.round(ratio * (chart.length - 1)));
  };

  const handleChartPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setChartDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateChartPoint(event.clientX, event.currentTarget);
  };

  const handleChartPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || chartDragging) {
      updateChartPoint(event.clientX, event.currentTarget);
    }
  };

  const handleChartPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    setChartDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleChartKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (chart.length < 2) return;
    const current = activeChartIndex < 0 ? chart.length - 1 : activeChartIndex;
    const keyTarget =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? chart.length - 1
          : event.key === "ArrowLeft"
            ? Math.max(0, current - 1)
            : event.key === "ArrowRight"
              ? Math.min(chart.length - 1, current + 1)
              : null;
    if (keyTarget === null) return;
    event.preventDefault();
    setChartPointIndex(keyTarget);
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Debt Clock home">
          <span className="brand-mark" aria-hidden="true">
            <Image
              className="brand-logo"
              src="/brand/debt-clock-logo.png"
              alt=""
              width={32}
              height={32}
              priority
            />
          </span>
          <span>DEBT//CLOCK</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#breakdown">Breakdown</a>
          <a href="#holders">Holders</a>
          <a href="#history">History</a>
          <a href="#methodology">Method</a>
        </nav>
        <a className="source-link" href={FISCAL_SOURCE} target="_blank" rel="noreferrer">
          Treasury source ↗
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-grid" aria-hidden="true" />
        <div className="eyebrow-row">
          <span className={`status-pill ${payload?.status ?? "loading"}`}>
            <span className="pulse" aria-hidden="true" />
            {loading
              ? "CONNECTING TO TREASURY"
              : payload?.status === "official"
                ? "OFFICIAL DATA ONLINE"
                : payload?.status === "partial"
                  ? "PARTIAL OFFICIAL DATA"
                  : "SOURCE UNAVAILABLE"}
          </span>
          <span className="as-of">
            {stats.latest ? `AS OF ${dateLabel(stats.latest.recordDate).toUpperCase()}` : "DAILY RELEASE"}
          </span>
        </div>

        <div className="hero-copy">
          <p className="hero-kicker">
            <Image
              className="country-flag hero-flag"
              src="/flags/us.png"
              alt="United States flag"
              width={30}
              height={20}
              priority
            />
            <span>UNITED STATES NATIONAL DEBT</span>
          </p>
          <h1 aria-live="polite">
            {loading ? "$—" : error ? "DATA UNAVAILABLE" : formatMoney(displayedTotal, 0)}
          </h1>
          <div className="counter-meta">
            <button
              className={showEstimate ? "mode-toggle active" : "mode-toggle"}
              type="button"
              onClick={() => setShowEstimate((value) => !value)}
              disabled={!stats.latest || stats.perSecond === 0}
              aria-pressed={showEstimate}
            >
              <span aria-hidden="true">{showEstimate ? "◉" : "○"}</span>
              {showEstimate ? "LIVE ESTIMATE ON" : "OFFICIAL FIGURE ONLY"}
            </button>
            <p>
              {showEstimate && stats.perSecond !== 0
                ? `Estimate moves at the trailing 30-day pace of ${formatSignedMoney(stats.perSecond)} per second.`
                : "Official Treasury figure. It changes after each business-day release."}
            </p>
          </div>
        </div>

        {error ? (
          <div className="data-alert" role="alert">
            <div>
              <strong>Official source did not answer.</strong>
              <span>{error} No substitute number is being shown.</span>
            </div>
            <button type="button" onClick={() => void loadDebt()}>Try again</button>
          </div>
        ) : payload?.notice ? (
          <div className="data-alert partial" role="status">
            <div>
              <strong>Limited data mode.</strong>
              <span>{payload.notice}</span>
            </div>
          </div>
        ) : null}

        <div className="hero-stats">
          <article>
            <span>Last official move</span>
            <strong className={stats.dailyChange && stats.dailyChange < 0 ? "down" : "up"}>
              {stats.dailyChange === null ? "—" : formatSignedMoney(stats.dailyChange)}
            </strong>
            <small>vs. previous business day</small>
          </article>
          <article>
            <span>Debt per resident</span>
            <strong>{stats.latest ? formatMoney(stats.latest.totalDebt / U_S_POPULATION_JAN_2026) : "—"}</strong>
            <small>using Jan. 1, 2026 Census estimate</small>
          </article>
          <article>
            <span>30-day change</span>
            <strong className={stats.monthlyChange && stats.monthlyChange < 0 ? "down" : "up"}>
              {stats.monthlyChange === null ? "—" : formatSignedMoney(stats.monthlyChange)}
            </strong>
            <small>calendar-day lookback</small>
          </article>
          <article>
            <span>12-month change</span>
            <strong className={stats.yearlyChange && stats.yearlyChange < 0 ? "down" : "up"}>
              {stats.yearlyChange === null ? "—" : formatSignedMoney(stats.yearlyChange)}
            </strong>
            <small>when full history is available</small>
          </article>
        </div>

        <div className="hero-rate-panel" aria-label="Effective federal funds rate">
          <div className="hero-rate-copy">
            <span>EFFECTIVE FEDERAL FUNDS RATE</span>
            <div>
              <strong>{effr ? `${effr.latest.toFixed(2)}%` : "—"}</strong>
              <small>
                {effr
                  ? `${effr.dailyChangeBps >= 0 ? "+" : ""}${effr.dailyChangeBps} bps · ${dateLabel(effr.asOf)}`
                  : "Waiting for the official New York Fed feed."}
              </small>
            </div>
          </div>
          <div className="hero-rate-chart">
            <div className="hero-rate-chart-head">
              <span>RECENT OFFICIAL EFFR OBSERVATIONS</span>
              <a href={EFFR_SOURCE} target="_blank" rel="noreferrer">NY Fed ↗</a>
            </div>
            {effr && effrPoints ? (
              <svg
                className="mini-line-chart"
                viewBox="0 0 100 32"
                preserveAspectRatio="none"
                role="img"
                aria-label="Recent effective federal funds rate chart"
              >
                <line className="grid-line" x1="0" x2="100" y1="8" y2="8" />
                <line className="grid-line" x1="0" x2="100" y1="16" y2="16" />
                <line className="grid-line" x1="0" x2="100" y1="24" y2="24" />
                <polyline points={effrPoints} />
              </svg>
            ) : (
              <div className="chart-empty">Official EFFR history is temporarily unavailable.</div>
            )}
          </div>
        </div>
      </section>

      <section className="section" id="breakdown">
        <div className="section-heading">
          <div>
            <span className="section-index">01 / COMPOSITION</span>
            <h2>Who holds the debt?</h2>
          </div>
          <p>Total public debt outstanding combines debt held by investors and government accounts.</p>
        </div>

        <div className="composition-grid">
          <article className="composition-card primary-card">
            <div className="card-topline">
              <span>SHARE OF TOTAL</span>
              <span>{publicShare === null ? "—" : `${publicShare.toFixed(1)}% / ${(100 - publicShare).toFixed(1)}%`}</span>
            </div>
            <div className="composition-bar" aria-label="Debt composition">
              <div className="public-bar" style={{ width: `${publicShare ?? 0}%` }} />
              <div className="intragov-bar" />
            </div>
            <div className="composition-legend">
              <div>
                <span className="legend-dot orange" />
                <p>Held by the public</p>
                <strong>{stats.latest?.debtHeldPublic ? formatCompactMoney(stats.latest.debtHeldPublic) : "—"}</strong>
                <small>Investors, the Federal Reserve, foreign holders, businesses, and state or local governments.</small>
              </div>
              <div>
                <span className="legend-dot cream" />
                <p>Intragovernmental</p>
                <strong>{stats.latest?.intragovernmental ? formatCompactMoney(stats.latest.intragovernmental) : "—"}</strong>
                <small>Treasury securities held by federal trust funds and other government accounts.</small>
              </div>
            </div>
          </article>

          <aside className="pace-card">
            <span className="section-index">TRAILING 30-DAY PACE</span>
            <div className="pace-value">
              <span>PER SECOND</span>
              <strong>{stats.perSecond ? formatSignedMoney(stats.perSecond) : "—"}</strong>
            </div>
            <div className="pace-row"><span>Per minute</span><strong>{stats.perSecond ? formatSignedMoney(stats.perSecond * 60) : "—"}</strong></div>
            <div className="pace-row"><span>Per hour</span><strong>{stats.perSecond ? formatSignedMoney(stats.perSecond * 3600) : "—"}</strong></div>
            <div className="pace-row"><span>Per day</span><strong>{stats.perSecond ? formatSignedMoney(stats.perSecond * SECONDS_PER_DAY) : "—"}</strong></div>
            <p>This is a backward-looking average, not a Treasury forecast.</p>
          </aside>
        </div>
      </section>

      <section className="section chart-section" id="history">
        <div className="section-heading">
          <div>
            <span className="section-index">02 / MOMENTUM</span>
            <h2>Debt over time</h2>
          </div>
          <div className="range-tabs extended" role="group" aria-label="Chart range">
            {(["30D", "90D", "1Y", "5Y", "10Y", "30Y", "MAX"] as RangeKey[]).map((item) => (
              <button
                key={item}
                type="button"
                className={range === item ? "active" : ""}
                onClick={() => {
                  setRange(item);
                  setChartPointIndex(null);
                }}
                aria-pressed={range === item}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-summary">
            <div>
              <span>PERIOD CHANGE</span>
              <strong>
                {chartRecords.length > 1
                  ? formatSignedMoney(chartRecords.at(-1)!.totalDebt - chartRecords[0].totalDebt)
                  : "—"}
              </strong>
            </div>
            <div className="chart-inspector" aria-live="polite">
              <span>ACTIVE OBSERVATION</span>
              <strong>{activeChartPoint ? dateLabel(activeChartPoint.recordDate) : "—"}</strong>
              <em>{activeChartPoint ? formatMoney(activeChartPoint.totalDebt) : "—"}</em>
              <small className={activeChartChange !== null && activeChartChange < 0 ? "down" : "up"}>
                {activeChartChange === null
                  ? "First plotted observation"
                  : `${formatSignedMoney(activeChartChange)} vs. prior plot`}
              </small>
            </div>
          </div>
          <p className="chart-help">
            Drag left/right on phone, move your pointer, tap, or use ← → to inspect an official observation. Long ranges are downsampled only for display; the period change uses the full returned history.
          </p>
          {historyLoading ? <p className="chart-loading-note">Loading {range} Treasury history…</p> : null}
          {historyError ? <p className="chart-loading-note">{historyError}</p> : null}
          <div
            className="chart"
            role="slider"
            tabIndex={chart.length > 1 ? 0 : -1}
            aria-disabled={chart.length <= 1}
            aria-label={`${range} U.S. debt history chart explorer`}
            aria-valuemin={1}
            aria-valuemax={Math.max(1, chart.length)}
            aria-valuenow={Math.max(1, activeChartIndex + 1)}
            aria-valuetext={
              activeChartPoint
                ? `${dateLabel(activeChartPoint.recordDate)}, ${formatMoney(activeChartPoint.totalDebt)}`
                : "No chart data"
            }
            onPointerMove={handleChartPointerMove}
            onPointerDown={handleChartPointerDown}
            onPointerUp={handleChartPointerEnd}
            onPointerCancel={handleChartPointerEnd}
            onKeyDown={handleChartKeyboard}
            style={chartStyle}
          >
            {chart.length > 1 ? (
              <>
                <span className="chart-cursor" aria-hidden="true" />
                {chart.map((point, index) => (
                  <div
                    className={index === activeChartIndex ? "chart-column active" : "chart-column"}
                    key={point.recordDate}
                    style={{ height: `${point.height}%` }}
                    aria-hidden="true"
                  />
                ))}
              </>
            ) : (
              <div className="chart-empty">Detailed history will appear when the Treasury data feed responds.</div>
            )}
          </div>
          <div className="chart-axis">
            <span>{chartRecords[0] ? dateLabel(chartRecords[0].recordDate) : "Start"}</span>
            <span>{chartRecords.at(-1) ? dateLabel(chartRecords.at(-1)!.recordDate) : "Latest"}</span>
          </div>
        </div>
      </section>

      <section className="section holders-section" id="holders">
        <div className="section-heading">
          <div>
            <span className="section-index">03 / GLOBAL HOLDERS + REAL RATES</span>
            <h2>Who holds Treasuries?</h2>
          </div>
          <p>Open any top-10 holder to see its local currency against USD alongside its Treasury position.</p>
        </div>

        <div className="holders-layout">
          <article className="leaderboard-card">
            <div className="leaderboard-head">
              <div>
                <span>TOP 10 FOREIGN HOLDERS</span>
                <strong>{holders?.status === "official" ? periodLabel(holders.asOf) : "Official data unavailable"}</strong>
              </div>
              {holders?.status === "official" ? (
                <div className="total-foreign">
                  <span>ALL FOREIGN HOLDERS</span>
                  <strong>{formatBillions(holders.totalForeign)} / {formatTrillions(holders.totalForeign)}</strong>
                  <small>equivalent USD</small>
                </div>
              ) : null}
            </div>

            {holders?.status === "official" ? (
              <div className="holder-list">
                {holders.countries.map((country) => {
                  const change = country.value - country.previousValue;
                  return (
                    <a
                      className="holder-row holder-row-link"
                      key={country.name}
                      href={`/holders/${slugify(country.name)}`}
                      aria-label={`Open ${country.name} Treasury holder and currency chart`}
                    >
                      <span className="holder-rank">{String(country.rank).padStart(2, "0")}</span>
                      <div className="holder-country">
                        <div className="holder-label">
                          <span className="holder-identity">
                            {COUNTRY_FLAG_PATHS[country.name] ? (
                              <Image
                                className="country-flag holder-flag"
                                src={COUNTRY_FLAG_PATHS[country.name]}
                                alt=""
                                width={28}
                                height={18}
                              />
                            ) : null}
                            <strong>{country.name}</strong>
                          </span>
                          <small className={change < 0 ? "down" : "up"}>{formatSignedMoney(change)} MoM</small>
                        </div>
                        <div className="holder-track" aria-hidden="true">
                          <span style={{ width: `${(country.value / largestHolding) * 100}%` }} />
                        </div>
                      </div>
                      <strong className="holder-value">
                        <span>{formatBillions(country.value)} / {formatTrillions(country.value)}</span>
                        <small>equivalent USD</small>
                      </strong>
                      <span className="holder-enter" aria-hidden="true">↗</span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="supplement-unavailable">{holders?.notice ?? "Waiting for the official Treasury TIC table."}</div>
            )}
          </article>

          <aside className="real-rate-card">
            <div className="real-rate-head">
              <span>10-YEAR TIPS REAL YIELD</span>
              <a href={REAL_YIELD_SOURCE} target="_blank" rel="noreferrer">Official feed ↗</a>
            </div>
            {realYields?.status === "official" ? (
              <>
                <div className="real-rate-value">
                  <strong>{realYields.tenYear.toFixed(2)}%</strong>
                  <span className={realYields.tenYearDailyChangeBps < 0 ? "down" : "up"}>
                    {realYields.tenYearDailyChangeBps >= 0 ? "+" : ""}{realYields.tenYearDailyChangeBps} bps daily
                  </span>
                </div>
                <p className="rate-date">Official close · {dateLabel(realYields.asOf)}</p>
                <div className="yield-curve" aria-label="Treasury real yield curve">
                  {realYields.curve.map((point) => (
                    <div key={point.tenor}>
                      <span>{point.tenor}</span>
                      <strong>{point.value.toFixed(2)}%</strong>
                    </div>
                  ))}
                </div>
                <div className="rate-explainer">
                  <strong>What this means</strong>
                  <p>This is the market real yield on inflation-protected Treasuries—not the Fed policy rate minus today&apos;s CPI. A positive 10Y real yield means investors can lock in a yield above future CPI adjustments before tax and trading costs.</p>
                </div>
              </>
            ) : (
              <div className="supplement-unavailable">{realYields?.notice ?? "Waiting for the official Treasury real-yield feed."}</div>
            )}
          </aside>
        </div>

        <div className="holding-note">
          <strong>READ THE RANKING CAREFULLY</strong>
          <p>TIC values are monthly and shown in USD. They are largely reported by U.S. custodians and broker-dealers, so a custody center such as Belgium, Luxembourg, or the Cayman Islands may not reveal the ultimate beneficial owner.</p>
          <a href={TIC_SOURCE} target="_blank" rel="noreferrer">Treasury TIC methodology ↗</a>
        </div>
      </section>

      <section className="section market-section">
        <div className="section-heading">
          <div>
            <span className="section-index">04 / MARKET LENS</span>
            <h2>Why markets care</h2>
          </div>
          <p>Debt alone is not a buy or sell signal. The path from borrowing to markets runs through rates, growth, inflation, and policy.</p>
        </div>
        <div className="market-grid">
          <article><span>01</span><h3>Treasury supply</h3><p>More borrowing can mean more bills, notes, and bonds offered to investors. Demand determines how easily that supply is absorbed.</p></article>
          <article><span>02</span><h3>Yields & the dollar</h3><p>If yields rise, global capital may favor U.S. assets. That can pressure currencies—but many other forces matter.</p></article>
          <article><span>03</span><h3>Risk assets</h3><p>Higher real yields can tighten financial conditions for stocks and crypto. Falling yields may help, but there is no automatic relationship.</p></article>
        </div>
        <div className="risk-note">
          <strong>⚠️ MARKET RISK</strong>
          <p>This dashboard explains public data; it does not predict yields, currencies, stocks, or crypto. Use position sizing and never trade from one macro number.</p>
        </div>
      </section>

      <section className="section method-section" id="methodology">
        <div className="section-heading">
          <div>
            <span className="section-index">05 / METHODOLOGY</span>
            <h2>Official first. Estimate second.</h2>
          </div>
        </div>
        <div className="method-grid">
          <article><span>1</span><div><h3>Fetch</h3><p>The server requests debt and holder data from U.S. Treasury sources, EFFR from the New York Fed, and reference FX history from Frankfurter&apos;s central-bank and official-source blend.</p></div></article>
          <article><span>2</span><div><h3>Verify</h3><p>Invalid debt rows are discarded. Long history is requested only when you select 5Y, 10Y, 30Y, or MAX so the initial page stays fast.</p></div></article>
          <article><span>3</span><div><h3>Estimate</h3><p>The optional moving counter extends the latest official total using the trailing 30-day average change, capped at four days.</p></div></article>
          <article><span>4</span><div><h3>Fail honestly</h3><p>If detailed debt data fails, the site tries TreasuryDirect for the official total. Supplemental charts show unavailable instead of inventing values.</p></div></article>
        </div>
        <div className="source-box">
          <div><span>PRIMARY SOURCE</span><strong>U.S. Treasury Bureau of the Fiscal Service</strong></div>
          <a href={FISCAL_SOURCE} target="_blank" rel="noreferrer">Open dataset ↗</a>
          <a href={TIC_SOURCE} target="_blank" rel="noreferrer">Foreign holders ↗</a>
          <a href={EFFR_SOURCE} target="_blank" rel="noreferrer">EFFR ↗</a>
          <a href={CENSUS_SOURCE} target="_blank" rel="noreferrer">Population input ↗</a>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top" aria-label="Debt Clock home">
          <span className="brand-mark" aria-hidden="true">
            <Image className="brand-logo" src="/brand/debt-clock-logo.png" alt="" width={32} height={32} />
          </span>
          <span>DEBT//CLOCK</span>
        </a>
        <p>Independent public-data interface. Not affiliated with the U.S. government.</p>
        <span>{payload ? `Last checked ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.fetchedAt))}` : "Awaiting official source"}</span>
      </footer>
    </main>
  );
}
