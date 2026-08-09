import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("dashboard keeps official-source and estimate semantics explicit", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("app/components/DebtDashboard.tsx", root), "utf8"),
    readFile(new URL("app/api/debt/route.ts", root), "utf8"),
  ]);

  assert.match(dashboard, /LIVE ESTIMATE ON/);
  assert.match(dashboard, /OFFICIAL FIGURE ONLY/);
  assert.match(dashboard, /backward-looking average, not a Treasury forecast/);
  assert.match(dashboard, /No substitute number is being shown/);
  assert.match(route, /api\.fiscaldata\.treasury\.gov/);
  assert.match(route, /status: "unavailable"/);
  assert.match(route, /No replacement number has been invented/);
});

test("dashboard includes the core detail sections", async () => {
  const dashboard = await readFile(
    new URL("app/components/DebtDashboard.tsx", root),
    "utf8",
  );

  for (const heading of [
    "Who holds the debt?",
    "Debt over time",
    "Why markets care",
    "Official first. Estimate second.",
  ]) {
    assert.match(dashboard, new RegExp(heading.replace(/[?.]/g, "\\$&")));
  }
});
