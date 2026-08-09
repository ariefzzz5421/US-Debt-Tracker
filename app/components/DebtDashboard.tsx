"use client";

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
};

type RangeKey = "30D" | "90D" | "1Y";

const U_S_POPULATION_JAN_2026 = 342_278_051;
const SECONDS_PER_DAY = 86_400;
const FISCAL_SOURCE =
  "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/";
const CENSUS_SOURCE =
  "https://www.census.gov/popclock/embed.php?component=pop_on_date&date=20260101";

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

export function DebtDashboard() {
  const [payload, setPayload] = useState<DebtPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [showEstimate, setShowEstimate] = useState(true);
  const [range, setRange] = useState<RangeKey>("90D");

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

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDebt(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDebt]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

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
    const count = range === "30D" ? 30 : range === "90D" ? 90 : 365;
    return (payload?.records ?? []).slice(0, count).reverse();
  }, [payload, range]);

  const chart = useMemo(() => {
    if (chartRecords.length < 2) return [];
    const maxPoints = 72;
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
  const displayedTotal = showEstimate
    ? stats.estimatedTotal
    : stats.officialTotal;

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Debt Clock home">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>DEBT//CLOCK</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#breakdown">Breakdown</a>
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
          <p>UNITED STATES NATIONAL DEBT</p>
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
      </section>

      <section className="section" id="breakdown">
        <div className="section-heading">
          <div>
            <span className="section-index">01 / COMPOSITION</span>
            <h2>Who holds the debt?</h2>
          </div>
          <p>
            Total public debt outstanding combines debt held by investors and government accounts.
          </p>
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
          <div className="range-tabs" role="group" aria-label="Chart range">
            {(["30D", "90D", "1Y"] as RangeKey[]).map((item) => (
              <button
                key={item}
                type="button"
                className={range === item ? "active" : ""}
                onClick={() => setRange(item)}
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
            <p>Each bar is an official daily observation. Weekends and federal holidays may have no new record.</p>
          </div>
          <div className="chart" aria-label={`${range} U.S. debt history chart`}>
            {chart.length > 1 ? (
              chart.map((point) => (
                <div
                  className="chart-column"
                  key={point.recordDate}
                  style={{ height: `${point.height}%` }}
                  title={`${dateLabel(point.recordDate)} — ${formatMoney(point.totalDebt)}`}
                />
              ))
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

      <section className="section market-section">
        <div className="section-heading">
          <div>
            <span className="section-index">03 / MARKET LENS</span>
            <h2>Why markets care</h2>
          </div>
          <p>Debt alone is not a buy or sell signal. The path from borrowing to markets runs through rates, growth, inflation, and policy.</p>
        </div>
        <div className="market-grid">
          <article><span>01</span><h3>Treasury supply</h3><p>More borrowing can mean more bills, notes, and bonds offered to investors. Demand determines how easily that supply is absorbed.</p></article>
          <article><span>02</span><h3>Yields & the dollar</h3><p>If yields rise, global capital may favor U.S. assets. That can pressure currencies such as IDR—but many other forces matter.</p></article>
          <article><span>03</span><h3>Risk assets</h3><p>Higher real yields can tighten financial conditions for stocks and crypto. Falling yields may help, but there is no automatic relationship.</p></article>
        </div>
        <div className="risk-note">
          <strong>⚠️ MARKET RISK</strong>
          <p>This dashboard explains public data; it does not predict yields, USD/IDR, stocks, or crypto. Use position sizing and never trade from one macro number.</p>
        </div>
      </section>

      <section className="section method-section" id="methodology">
        <div className="section-heading">
          <div>
            <span className="section-index">04 / METHODOLOGY</span>
            <h2>Official first. Estimate second.</h2>
          </div>
        </div>
        <div className="method-grid">
          <article><span>1</span><div><h3>Fetch</h3><p>The server requests up to 400 daily observations from Treasury’s “Debt to the Penny” dataset and caches them for one hour.</p></div></article>
          <article><span>2</span><div><h3>Verify</h3><p>Every row must include a date, total debt, debt held by the public, and intragovernmental holdings. Invalid rows are discarded.</p></div></article>
          <article><span>3</span><div><h3>Estimate</h3><p>The optional moving counter extends the latest official total using the trailing 30-day average change, capped at four days.</p></div></article>
          <article><span>4</span><div><h3>Fail honestly</h3><p>If detailed data fails, the site tries TreasuryDirect for the official total. If both fail, it shows “unavailable” instead of stale or invented data.</p></div></article>
        </div>
        <div className="source-box">
          <div><span>PRIMARY SOURCE</span><strong>U.S. Treasury Bureau of the Fiscal Service</strong></div>
          <a href={FISCAL_SOURCE} target="_blank" rel="noreferrer">Open dataset ↗</a>
          <a href={CENSUS_SOURCE} target="_blank" rel="noreferrer">Population input ↗</a>
        </div>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">D</span><span>DEBT//CLOCK</span></a>
        <p>Independent public-data interface. Not affiliated with the U.S. government.</p>
        <span>{payload ? `Last checked ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.fetchedAt))}` : "Awaiting official source"}</span>
      </footer>
    </main>
  );
}
