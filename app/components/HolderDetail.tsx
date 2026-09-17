"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type FxRange = "1M" | "1Y" | "5Y" | "10Y" | "MAX";

type FxRecord = { date: string; rate: number };

type HolderPayload = {
  status: "official" | "not-found" | "unavailable";
  asOf?: string;
  previousPeriod?: string;
  notice?: string;
  holder?: {
    rank: number;
    name: string;
    slug: string;
    value: number;
    previousValue: number;
    currency: { code: string; name: string } | null;
    flagPath: string | null;
  };
  fx?:
    | {
        status: "available";
        pair: string;
        currencyName: string;
        range: FxRange;
        latest: number;
        liveStatus: "live" | "reference";
        liveAsOf: string;
        liveSource: string;
        changePercent: number;
        records: FxRecord[];
        source: string;
        cadence: string;
      }
    | { status: "unavailable"; pair?: string; notice: string };
};

type FxChartStyle = CSSProperties & {
  "--fx-cursor-position": string;
  "--fx-price-position": string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function recordDateLabel(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function quoteTimeLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function formatRate(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value < 10 ? 4 : 2,
    maximumFractionDigits: value < 10 ? 4 : 4,
  });
}

function makeChartGeometry(records: FxRecord[], focusRate?: number) {
  if (records.length < 2) {
    return {
      points: "",
      positions: [] as Array<{ x: number; y: number }>,
      yForRate: () => 50,
    };
  }

  const values = records.map((item) => item.rate);
  if (Number.isFinite(focusRate)) values.push(Number(focusRate));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const yForRate = (rate: number) =>
    Math.max(7, Math.min(93, 93 - ((rate - min) / spread) * 86));
  const positions = records.map((item, index) => ({
    x: (index / (records.length - 1)) * 100,
    y: yForRate(item.rate),
  }));

  return {
    points: positions
      .map((position) => `${position.x.toFixed(2)},${position.y.toFixed(2)}`)
      .join(" "),
    positions,
    yForRate,
  };
}

export function HolderDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [range, setRange] = useState<FxRange>("1Y");
  const [payload, setPayload] = useState<HolderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectIndex, setInspectIndex] = useState<number | null>(null);
  const [chartDragging, setChartDragging] = useState(false);
  const cacheRef = useRef(new Map<FxRange, HolderPayload>());
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const cached = cacheRef.current.get(range);
    if (cached) {
      setPayload(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    setInspectIndex(null);

    fetch(`/api/holders?slug=${encodeURIComponent(slug)}&range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as HolderPayload;
        if (!response.ok && data.status !== "not-found") {
          throw new Error(data.notice ?? "Holder data is unavailable.");
        }
        cacheRef.current.set(range, data);
        setPayload(data);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Holder data is unavailable.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [slug, range]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const controller = new AbortController();
      fetch(`/api/holders?slug=${encodeURIComponent(slug)}&range=${range}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as HolderPayload;
        })
        .then((data) => {
          if (!data) return;
          cacheRef.current.set(range, data);
          setPayload(data);
        })
        .catch(() => undefined);
    }, 60_000);

    return () => window.clearInterval(refresh);
  }, [slug, range]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const holder = payload?.holder;
  const fx = payload?.fx?.status === "available" ? payload.fx : null;
  const holdingChange = holder ? holder.value - holder.previousValue : null;
  const records = fx?.records ?? [];
  const activeIndex =
    records.length > 0
      ? Math.min(inspectIndex ?? records.length - 1, records.length - 1)
      : -1;
  const activeRecord = inspectIndex !== null && activeIndex >= 0 ? records[activeIndex] : null;
  const displayedRate = activeRecord?.rate ?? fx?.latest ?? null;
  const chartGeometry = useMemo(
    () => makeChartGeometry(records, fx?.latest),
    [records, fx?.latest],
  );
  const displayedY =
    displayedRate === null ? 50 : chartGeometry.yForRate(displayedRate);
  const displayedX = activeRecord
    ? chartGeometry.positions[activeIndex]?.x ?? 100
    : 100;
  const chartStyle = {
    "--fx-cursor-position": `${displayedX}%`,
    "--fx-price-position": `${displayedY}%`,
  } as FxChartStyle;

  const queueChartPoint = (clientX: number, element: HTMLDivElement) => {
    if (records.length < 2) return;
    const bounds = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const nextIndex = Math.round(ratio * (records.length - 1));

    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      setInspectIndex(nextIndex);
      frameRef.current = null;
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setChartDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    queueChartPoint(event.clientX, event.currentTarget);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || chartDragging) {
      queueChartPoint(event.clientX, event.currentTarget);
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    setChartDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleChartKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (records.length < 2) return;
    const current = activeIndex < 0 ? records.length - 1 : activeIndex;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? records.length - 1
          : event.key === "ArrowLeft"
            ? Math.max(0, current - 1)
            : event.key === "ArrowRight"
              ? Math.min(records.length - 1, current + 1)
              : null;
    if (next === null) return;
    event.preventDefault();
    setInspectIndex(next);
  };

  return (
    <main className="holder-detail-page">
      <div className="holder-detail-shell">
        <div className="holder-detail-nav">
          <a className="brand" href="/" aria-label="Debt Clock home">
            <span>DEBT//CLOCK</span>
          </a>
          <a className="back-link" href="/#holders">← BACK TO TOP 10</a>
        </div>

        {loading && !payload ? (
          <div className="detail-unavailable">Loading official Treasury holder data…</div>
        ) : error ? (
          <div className="detail-unavailable">{error}</div>
        ) : payload?.status === "not-found" ? (
          <div className="detail-unavailable">
            {payload.notice ?? "This country is not in the current top 10."}
          </div>
        ) : holder ? (
          <>
            <section className="holder-detail-hero">
              <span className="holder-detail-kicker">
                #{String(holder.rank).padStart(2, "0")} FOREIGN HOLDER · {dateLabel(payload?.asOf)}
              </span>
              <div className="holder-detail-title-row">
                {holder.flagPath ? (
                  <Image
                    className="holder-detail-flag"
                    src={holder.flagPath}
                    alt={`${holder.name} flag`}
                    width={72}
                    height={48}
                    priority
                  />
                ) : null}
                <h1 className="holder-detail-title">{holder.name}</h1>
              </div>
              <div className="holder-detail-metrics">
                <div>
                  <span>TREASURY HOLDINGS</span>
                  <strong>{formatMoney(holder.value)}</strong>
                </div>
                <div>
                  <span>MONTH-OVER-MONTH</span>
                  <strong className={(holdingChange ?? 0) < 0 ? "down" : "up"}>
                    {holdingChange === null
                      ? "—"
                      : `${holdingChange >= 0 ? "+" : "−"}${formatMoney(Math.abs(holdingChange))}`}
                  </strong>
                </div>
                <div>
                  <span>LOCAL CURRENCY</span>
                  <strong>
                    {holder.currency
                      ? `${holder.currency.code} · ${holder.currency.name}`
                      : "Not mapped"}
                  </strong>
                </div>
              </div>
            </section>

            <section className="fx-card">
              <div className="fx-card-head">
                <div>
                  <span className="fx-label">LOCAL CURRENCY VS U.S. DOLLAR</span>
                  <h2>{fx?.pair ?? payload?.fx?.pair ?? "FX chart"}</h2>
                </div>
                {fx ? (
                  <div className="fx-latest">
                    <div className="fx-live-line">
                      <span className={fx.liveStatus === "live" ? "fx-live-badge" : "fx-ref-badge"}>
                        {fx.liveStatus === "live" ? "LIVE" : "REFERENCE"}
                      </span>
                      <strong>{formatRate(fx.latest)}</strong>
                    </div>
                    <small>
                      {quoteTimeLabel(fx.liveAsOf)} · {fx.changePercent >= 0 ? "+" : ""}
                      {fx.changePercent.toFixed(2)}% over {range}
                    </small>
                  </div>
                ) : null}
              </div>

              <div className="fx-range-tabs" role="group" aria-label="FX chart range">
                {(["1M", "1Y", "5Y", "10Y", "MAX"] as FxRange[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={range === item ? "active" : ""}
                    aria-pressed={range === item}
                    onClick={() => setRange(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              {loading && payload ? (
                <p className="chart-loading-note">Refreshing {range} FX history…</p>
              ) : fx && chartGeometry.points ? (
                <div className="fx-chart-wrap">
                  <div className="fx-chart-interactive" style={chartStyle}>
                    <div
                      className="fx-chart-plot"
                      role="slider"
                      tabIndex={records.length > 1 ? 0 : -1}
                      aria-label={`${fx.pair} interactive exchange-rate chart for ${range}`}
                      aria-valuemin={1}
                      aria-valuemax={Math.max(1, records.length)}
                      aria-valuenow={Math.max(1, activeIndex + 1)}
                      aria-valuetext={
                        activeRecord
                          ? `${recordDateLabel(activeRecord.date)}, ${formatRate(activeRecord.rate)}`
                          : `${fx.liveStatus === "live" ? "Live" : "Latest reference"}, ${formatRate(fx.latest)}`
                      }
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerEnd}
                      onPointerCancel={handlePointerEnd}
                      onPointerLeave={() => {
                        if (!chartDragging) setInspectIndex(null);
                      }}
                      onKeyDown={handleChartKeyboard}
                    >
                      <svg
                        className="fx-chart"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label={`${fx.pair} exchange-rate chart for ${range}`}
                      >
                        <line className="grid-line" x1="0" x2="100" y1="25" y2="25" />
                        <line className="grid-line" x1="0" x2="100" y1="50" y2="50" />
                        <line className="grid-line" x1="0" x2="100" y1="75" y2="75" />
                        <line
                          className="fx-focus-line"
                          x1={displayedX}
                          x2={displayedX}
                          y1="0"
                          y2="100"
                        />
                        <line
                          className="fx-price-line"
                          x1={displayedX}
                          x2="100"
                          y1={displayedY}
                          y2={displayedY}
                        />
                        <polyline points={chartGeometry.points} />
                      </svg>
                    </div>

                    <div className="fx-price-tag" aria-live="polite">
                      <span>
                        {activeRecord
                          ? recordDateLabel(activeRecord.date)
                          : fx.liveStatus === "live"
                            ? "LIVE QUOTE"
                            : "LATEST REF"}
                      </span>
                      <strong>{displayedRate === null ? "—" : formatRate(displayedRate)}</strong>
                      <small>
                        {activeRecord ? fx.pair : quoteTimeLabel(fx.liveAsOf)}
                      </small>
                    </div>
                  </div>
                  <div className="fx-chart-footer">
                    <span>{recordDateLabel(records[0]?.date)}</span>
                    <span>Drag / swipe to inspect</span>
                    <span>{recordDateLabel(records.at(-1)?.date)}</span>
                  </div>
                </div>
              ) : (
                <div className="detail-unavailable">
                  {payload?.fx?.status === "unavailable"
                    ? payload.fx.notice
                    : "FX history is unavailable."}
                </div>
              )}

              {fx ? (
                <p className="fx-source">
                  Historical series: {fx.source}. {fx.cadence}. Current label: {fx.liveSource}.
                  When a near-real-time quote is unavailable, the UI explicitly falls back to the latest reference observation.
                </p>
              ) : null}
            </section>
          </>
        ) : (
          <div className="detail-unavailable">Holder data is unavailable.</div>
        )}
      </div>
    </main>
  );
}
