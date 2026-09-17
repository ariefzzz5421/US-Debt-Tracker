import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("dashboard keeps official-source and estimate semantics explicit", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("app/components/DebtDashboardEnhanced.tsx", root), "utf8"),
    readFile(new URL("app/api/debt/route.ts", root), "utf8"),
  ]);

  assert.match(dashboard, /LIVE ESTIMATE ON/);
  assert.match(dashboard, /OFFICIAL FIGURE ONLY/);
  assert.match(dashboard, /backward-looking average, not a Treasury forecast/);
  assert.match(dashboard, /No substitute number is being shown/);
  assert.match(route, /api\.fiscaldata\.treasury\.gov/);
  assert.match(route, /slt_table5\.txt/);
  assert.match(route, /daily_treasury_real_yield_curve/);
  assert.match(route, /slice\(0, 10\)/);
  assert.match(route, /status: "unavailable"/);
  assert.match(route, /No replacement number has been invented/);
});

test("dashboard includes long history, mobile dragging, holder drilldowns, and EFFR", async () => {
  const dashboard = await readFile(
    new URL("app/components/DebtDashboardEnhanced.tsx", root),
    "utf8",
  );

  for (const range of ["5Y", "10Y", "30Y", "MAX"]) {
    assert.match(dashboard, new RegExp(`"${range}"`));
  }
  assert.match(dashboard, /\/api\/debt\/history\?range=/);
  assert.match(dashboard, /setPointerCapture/);
  assert.match(dashboard, /onPointerCancel=\{handleChartPointerEnd\}/);
  assert.match(dashboard, /\/holders\/\$\{slugify\(country\.name\)\}/);
  assert.match(dashboard, /EFFECTIVE FEDERAL FUNDS RATE/);
  assert.match(dashboard, /\/api\/rates/);
});

test("new endpoints use official Treasury and New York Fed sources plus reference FX", async () => {
  const [history, holders, rates] = await Promise.all([
    readFile(new URL("app/api/debt/history/route.ts", root), "utf8"),
    readFile(new URL("app/api/holders/route.ts", root), "utf8"),
    readFile(new URL("app/api/rates/route.ts", root), "utf8"),
  ]);

  assert.match(history, /debt_to_penny/);
  assert.match(history, /page\[size\]/);
  assert.match(holders, /slt_table5\.txt/);
  assert.match(holders, /api\.frankfurter\.dev/);
  assert.match(holders, /USD\/\$\{holder\.currency\.code\}/);
  assert.match(rates, /markets\.newyorkfed\.org/);
  assert.match(rates, /unsecured\/effr/);
});

test("holder detail route exposes FX ranges", async () => {
  const detail = await readFile(
    new URL("app/components/HolderDetail.tsx", root),
    "utf8",
  );
  assert.match(detail, /1M/);
  assert.match(detail, /1Y/);
  assert.match(detail, /5Y/);
  assert.match(detail, /\/api\/holders\?slug=/);
  assert.match(detail, /LOCAL CURRENCY VS U\.S\. DOLLAR/);
});
