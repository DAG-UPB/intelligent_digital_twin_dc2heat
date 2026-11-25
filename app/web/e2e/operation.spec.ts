/**
 * Operation's heat pump operation (pages/twin/HeatPumpOperation.tsx, operation.ts): three strategies on the same
 * plant, the look-ahead no dearer than heat-led; and on Heat Matching each part's model under its switch and the
 * network's temperatures under What if… (a heating curve moves the KPIs). Read-only (readonly.ts).
 * `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/operation.spec.ts`
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_recovery_air"));
  await readOnly(context);
});

test("heat pump operation: scenarios over a year, the look-ahead cheaper than heat-led, every strategy per year", async ({ page }) => {
  await page.goto("/#/twin/planning");
  const scen = page.getByRole("table", { name: "Scenarios" });
  await expect(scen.getByRole("row")).toHaveCount(7, { timeout: 90_000 }); // the head and six scenarios (two of them what-ifs: demand ×2, data center heat ×2)
  await expect(scen).not.toContainText("…", { timeout: 120_000 }); // all run (in the worker)
  const mpc = scen.locator("tbody tr").first().locator(".plan-mpc");
  await expect(mpc).toHaveText(/^−\d/); // cheaper than heat-led
  const perYear = page.getByRole("table", { name: "Per year" });
  await expect(perYear.getByRole("rowheader", { name: "MPC (look-ahead)" })).toHaveCount(1); // one year in the evaluated period, each strategy
  // a bigger tank for the first scenario: its MPC runs again
  const before = await mpc.innerText();
  await page.getByLabel("As set above: storage, kWh").fill("6000");
  await expect.poll(() => mpc.innerText(), { timeout: 60_000 }).not.toBe(before);
  await page.getByRole("radio", { name: "CO₂" }).click(); // optimise for CO₂: the scenarios compare tonnes
  await expect(scen.getByRole("columnheader", { name: "Heat-led (t)" })).toBeVisible();
});

test("SMARD files that miss the page's year: the synthetic year, and the page says what the files cover", async ({ page }) => {
  await page.route("**/api/market/hourly**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    const times: number[] = [];
    for (let t = Number(q.get("start")); t < Number(q.get("end")); t += 3600) times.push(t);
    const none = times.map(() => null);
    const span: [string, string] = ["2023-01-01T00:00:00+00:00", "2025-01-01T00:00:00+00:00"];
    return route.fulfill({ json: { times, price_eur_mwh: none, co2_g_kwh: none, files: { price: ["p.csv"], co2: ["g.csv"] }, span: { price: span, co2: span }, covered: { price: 0, co2: 0 } } });
  });
  await page.goto("/#/twin/planning");
  await expect(page.getByText("SMARD's files cover 2023-01-01 to 2025-01-01; this year is outside them")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel("Price and CO₂ from")).toHaveValue("synthetic");
});

test("the data center's avoided cooling: only with the heat pump ahead of the cooling (hot aisle, liquid); counted, a key figure and a column per year, and the cost moves", async ({ page }) => {
  test.setTimeout(400_000);
  // Heat Matching's plant takes the heat in the hall (the hot aisle) and saves the weather with it
  await page.goto("/#/twin/matching");
  await expect(page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" })).toContainText(/\d+\s*[MG]Wh/, { timeout: 180_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("heat-matching") ?? "{}").at), { timeout: 90_000 }).toBe("hall");
  await page.goto("/#/twin/planning");
  const scen = page.getByRole("table", { name: "Scenarios" });
  await expect(scen.getByRole("row")).toHaveCount(7, { timeout: 90_000 });
  await expect(scen).not.toContainText("…", { timeout: 120_000 });
  await expect(page.getByText("working…")).toHaveCount(0, { timeout: 120_000 });
  const row = scen.locator("tbody tr").first();
  const before = await row.innerText();
  await page.getByLabel("Data center cooling avoided").selectOption({ label: "Wet cooling tower" });
  await expect(page.getByText("DC cooling avoided", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("table", { name: "Per year" }).getByRole("columnheader", { name: "DC cooling avoided (MWh el.)" })).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => row.innerText(), { timeout: 120_000 }).not.toBe(before); // net of the avoided cooling: cheaper
  await page.getByLabel("Data center cooling avoided").selectOption({ label: "Not counted" });
  await expect(page.getByText("DC cooling avoided", { exact: true })).toHaveCount(0);
  // defined here the heat is taken at the condenser: the cooling runs as before, nothing to count
  await page.getByRole("radio", { name: "Define here" }).click();
  await expect(page.getByText(/counts only when the heat pump takes its heat before the cooling/)).toBeVisible();
  await expect(page.getByLabel("Data center cooling avoided")).toHaveCount(0);
});

test("heat pump operation: the storage with a temperature (RC), its numbers and its temperature against the supply", async ({ page }) => {
  await page.goto("/#/twin/planning");
  const scen = page.getByRole("table", { name: "Scenarios" });
  await expect(scen).not.toContainText("…", { timeout: 120_000 });
  await expect(page.getByText("working…")).toHaveCount(0, { timeout: 120_000 }); // the market's prices arrived and ran
  const row = scen.locator("tbody tr").first();
  const mpc = row.locator(".plan-mpc");
  const before = await row.innerText(); // heat-led's € and the strategies' %: a % alone may round alike on both tanks
  await expect(page.getByLabel("Standing loss")).toBeVisible();
  await page.getByRole("radiogroup", { name: "Storage model" }).getByRole("radio", { name: "With temperature" }).click();
  for (const f of ["Empty at", "Full at", "Around the tank", "Storage time constant", "Max. charge", "Max. discharge"]) await expect(page.getByLabel(f)).toBeVisible();
  await expect(page.getByLabel("Standing loss")).toHaveCount(0);
  await expect.poll(() => row.innerText(), { timeout: 120_000 }).not.toBe(before); // every scenario runs again on the new tank
  await expect(scen).not.toContainText("…", { timeout: 120_000 });
  await expect(mpc).toHaveText(/^−\d/); // the look-ahead still beats heat-led
  // a tank outdoors: below 0 °C around it (the field held at 0 before)
  await page.getByLabel("Around the tank").fill("-5");
  await expect(page.getByLabel("Around the tank")).toHaveValue("-5");
  await page.locator(".plan-op-week").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/operation-rc.png", fullPage: true });
});

test("Operation runs on Heat Matching's plant, or on one defined here", async ({ page }) => {
  await page.goto("/#/twin/matching");
  await expect(page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" })).toContainText(/\d+\s*GWh/, { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem("heat-matching")), { timeout: 60_000 }).toBe(true); // kept once it settles
  await page.goto("/#/twin/planning");
  const plant = page.getByRole("complementary", { name: "Plant" });
  await expect(plant).toContainText("Plant · as on Heat Matching");
  await expect(plant).toContainText("Demand:");
  await page.getByRole("radio", { name: "Define here" }).click();
  await expect(plant).toContainText("Plant · HP 1 MW");
  await expect(page.getByRole("img", { name: /heat pump 1 MW, storage 500 kWh/ })).toBeVisible();
});

test("Heat Matching: a model per part under its switch, and a heating curve for the network", async ({ page }) => {
  await page.goto("/#/twin/matching");
  const delivered = page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" });
  await expect(delivered).toContainText(/\d+\s*GWh/, { timeout: 120_000 });
  // each part's model and system: a folder at the top right of its column, next to "Model ›"
  for (const label of ["Data center: model and system", "Heat distribution: model and system", "District: demand and system"])
    await expect(page.locator("label.heat-load", { has: page.getByLabel(label, { exact: true }) })).toBeVisible();
  // the three systems, each picked on its own: another dataset as the district
  await page.getByLabel("District: demand and system").selectOption("system:sim_district_heat");
  await expect(delivered).toContainText(/of 5,5\d GWh demand/, { timeout: 60_000 });
  await page.getByLabel("District: demand and system").selectOption("system:sim_recovery_air");
  const open = page.locator(".heat-cards details[open] > summary");
  while ((await open.count()) > 0) await open.first().click();
  await page.getByText("What if…", { exact: true }).click();
  // the district's model runs again after the switch back: the baseline once the number holds still
  let base = "";
  await expect.poll(async () => {
    const was = base;
    base = await delivered.innerText();
    return was === base;
  }, { intervals: [1000] }).toBe(true);
  await page.getByLabel("Network supply temperature, °C").fill("65"); // cooler supply: a smaller lift, a higher COP (the 2 MW unit stops above 72 °C)
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect.poll(() => delivered.innerText()).not.toBe(base);
  const hot = await delivered.innerText();
  await page.getByLabel("Supply follows the outdoor temperature").check();
  await expect(page.getByLabel("Network supply in summer, °C")).toBeVisible();
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect.poll(() => delivered.innerText()).not.toBe(hot);
  await page.getByRole("button", { name: "As on the Site map" }).click();
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect.poll(() => delivered.innerText()).toBe(base);
});

test("cases: one pick sets the three systems and shows which models they run", async ({ page }) => {
  await page.goto("/#/twin/matching");
  const kase = page.getByRole("combobox", { name: "Case" });
  await expect(kase).toHaveValue("Case 1 · Recovery, trained models"); // the example's datasets and models as they are
  await page.locator(".subtabs__systems > summary").click(); // the case's three systems, under one button
  await expect(page.getByRole("combobox", { name: "Data center", exact: true })).toHaveAttribute("title", /model: XGB · Causal graph/);
  await expect(page.getByRole("combobox", { name: "District", exact: true })).toHaveAttribute("title", /demand: XGB · Causal graph/);
  await kase.selectOption("Case 3 · Recovery, measured district");
  await expect(page.getByRole("combobox", { name: "District", exact: true })).toHaveValue("sim_district_heat");
  await expect(page.locator("label.heat-load", { has: page.getByLabel("District: demand and system") })).toHaveAttribute("title", /District · heat demand/); // Heat Matching follows it
});

test("started with ?case=1 (start.sh): Case 1 on the Site map, whatever was picked before; the address without it", async ({ page }) => {
  await page.addInitScript(() => localStorage.getItem("case") === null && localStorage.setItem("dataset:district/map", "sim_district_heat"));
  await page.goto("/?case=1#/twin/map");
  await expect(page.getByRole("combobox", { name: "Case" })).toHaveValue("Case 1 · Recovery, trained models");
  await page.locator(".subtabs__systems > summary").click(); // the case's three systems, under one button
  await expect(page.getByRole("combobox", { name: "District", exact: true })).toHaveValue("sim_recovery_air");
  expect(new URL(page.url()).search).toBe("");
});

test("the district's demand from the foundation model: a year from the weather (Chronos-2, a run of about a minute)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/#/twin/matching");
  const delivered = page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" });
  await page.getByLabel("District: demand and system").selectOption("system:sim_district_heat");
  await expect(delivered).toContainText("of 5,57 GWh demand", { timeout: 120_000 }); // as measured
  await page.getByLabel("District: demand and system").selectOption("model:fm:weather");
  // learned from the district's measured years, run on the shared weather (the data center's, Frankfurt's: colder than
  // the district's own, so a little more demand)
  await expect(delivered).toContainText(/of [4-8],\d\d GWh demand/, { timeout: 240_000 });
  await expect(delivered).not.toContainText("of 5,57 GWh demand"); // the model's year, not the measurement
});

test("Structure and Modelling: the rolling comparison rolls the saved models over the last year, with an intervention", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dataset:district/structure", "sim_recovery_air"));
  await page.goto("/#/district/structure");
  const title = page.getByText("Rolling comparison", { exact: true });
  for (let i = 0; i < 30 && !(await title.count()); i++) {
    await page.mouse.move(700, 600);
    await page.mouse.wheel(0, 1500); // the modelling part loads when scrolled to
    await page.waitForTimeout(500);
  }
  const card = page.locator("section.card", { has: title });
  await expect(card.getByLabel("Chronos-2 (pretrained)")).not.toBeChecked(); // only when asked for
  for (const m of ["XGB · Causal graph", "Physics · Causal graph"]) await card.getByLabel(m).uncheck(); // the linear one only: quick
  await card.getByRole("button", { name: "Roll and compare" }).click();
  const table = card.getByRole("table", { name: "Rolling comparison" });
  await expect(table.getByRole("rowheader", { name: "LR · Causal graph" })).toBeVisible({ timeout: 120_000 });
  await expect(table).toContainText("With Out_Temp +3");
  await expect(table.locator("tbody tr").first()).toContainText(/−\d+ %/); // warmer: less demand
});
