"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type FxRange = "1M" | "1Y" | "5Y";

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
  };
  fx?:
    | {
        status: "available";
        pair: string;
        currencyName: string;
        range: FxRange;
        latest: number;
        changePercent: number;
        records: Array<{ date: string; rate: number }>;
        source: string;
        cadence: string;
      }
    | { status: "unavailable"; pair?: string; notice: string };
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

function makePolyline(records: Array<{ rate: number }>) {
  if (records.length < 2) return "";
  const values = records.map((item) => item.rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return records
    .map((item, index) => {
      const x = (index / (records.length - 1)) * 100;
      const y = 92 - ((item.rate - min) / spread) * 84;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function HolderDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [range, setRange] = useState<FxRange>("1Y");
  const [payload, setPayload] = useState<HolderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/holders?slug=${encodeURIComponent(slug)}&range=${range}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as HolderPayload;
        if (!response.ok && data.status !== "not-found") {
          throw new Error(data.notice ?? "Holder data is unavailable.");
        }
        setPayload(data);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Holder data is unavailable.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [slug, range]);

  const holder = payload?.holder;
  const fx = payload?.fx?.status === "available" ? payload.fx : null;
  const points = useMemo(() => makePolyline(fx?.records ?? []), [fx]);
  const holdingChange = holder ? holder.value - holder.previousValue : null;

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
              <h1 className="holder-detail-title">{holder.name}</h1>
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
                    <strong>{fx.latest.toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong>
                    <small className={fx.changePercent < 0 ? "down" : "up"}>
                      {fx.changePercent >= 0 ? "+" : ""}
                      {fx.changePercent.toFixed(2)}% over {range}
                    </small>
                  </div>
                ) : null}
              </div>

              <div className="fx-range-tabs" role="group" aria-label="FX chart range">
                {(["1M", "1Y", "5Y"] as FxRange[]).map((item) => (
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
              ) : fx && points ? (
                <div className="fx-chart-wrap">
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
                    <polyline points={points} />
                  </svg>
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
                  {fx.source}. These are reference rates, not an intraday trading feed. {fx.cadence}.
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
