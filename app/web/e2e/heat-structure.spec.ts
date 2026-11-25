/**
 * Heat Distribution › Structure (#/heat/structure): the data center's P&ID page for the heat distribution, on its own
 * files (scope=heat). Read-only: the save is mocked here (readonly.ts aborts every other write).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/heat-structure.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

const SVG = 'svg[aria-label="P&ID with causal links"]';
const instrument = (page: Page, v: string) => page.locator(`${SVG} g:has(> text:text-is("${v}")) > circle`);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await context.addInitScript(() => ["dc", "heat", "district"].forEach((s) => localStorage.setItem(`${s}-structure-edit`, "1"))); // the Structure pages in edit mode (PidPage)
  await readOnly(context);
});

test("the heat distribution's drawing with its water variables; a drawn link is saved to its own files", async ({ page }) => {
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  await page.route(/\/api\/datasets\/sim_1_modified\/(graph\/save|site)\?scope=heat$/, (r) => {
    if (r.request().method() === "GET") return r.fallback();
    writes.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({ json: r.request().url().includes("/site") ? r.request().postDataJSON() : { file_name: "causal_graph.json", edge_count: 1 } });
  });
  await page.goto("/#/heat/structure");
  await expect(page.getByRole("heading", { name: "Heat distribution · Structure and Modelling" })).toBeVisible();
  for (const part of ["Data center", "Heat exchanger", "Heat pump", "Storage tank", "District heat"])
    await expect(page.locator(SVG).getByText(part, { exact: true })).toBeVisible();
  // the water on both sides, the data center's heat and the district's demand; named as the data's columns where it
  // has them (the condenser HEX, site.json hex_option: T_dc_supply, m_dc; Q_demand the heat demand; Q_hex stays: its
  // column is calculated, never a graph node)
  for (const v of ["Q_dc", "HEX_Cond_T_in", "HEX_Cond_m", "Q_hex", "COP", "E_tank", "Heat_Demand", "m_dh"]) await expect(instrument(page, v)).toBeVisible();
  await expect(instrument(page, "T_dc_supply")).toHaveCount(0);
  await expect(instrument(page, "In_Temp")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Causal discovery" })).toBeVisible(); // lag discovery, on the data center's data
  // the data center's columns can be added; one with data is drawn solid, the starters without data dashed
  await page.getByRole("button", { name: "+ Variable" }).click();
  await expect(page.locator("#pid-columns option[value='HEX_Hall_m']")).toHaveCount(1);

  await page.getByRole("button", { name: "+ Add link" }).click();
  await instrument(page, "Q_dc").click({ force: true });
  await instrument(page, "Q_hex").click({ force: true });
  await expect(page.locator("aside strong").first()).toHaveText("Q_dc → Q_hex");
  await page.getByRole("button", { name: "Save to causal_graph.json" }).click();
  await expect.poll(() => writes.length).toBe(2);
  const graph = writes.find((w) => w.url.includes("/graph/save"))!.body as { targets: Record<string, { parent: string; lag: number }[]> };
  // the starting links of the physics, and the one drawn here
  expect(graph.targets.Q_hex).toEqual(
    expect.arrayContaining([
      { parent: "Q_dc", lag: -1 },
      { parent: "HEX_Cond_T_in", lag: -1 },
    ]),
  );
  expect(graph.targets.E_tank).toEqual(expect.arrayContaining([{ parent: "E_tank", lag: -1 }])); // the tank keeps its energy
  expect(Object.keys(graph.targets)).toContain("T_dh_return");
  const site = writes.find((w) => w.url.includes("/site"))!.body as { pid_layout: Record<string, unknown> };
  expect(site.pid_layout.Q_dc).toBeTruthy();
  expect((site as { pid_notes: Record<string, { kind: string }> }).pid_notes.hp_load.kind).toBe("actuator"); // the heat pump's load
});

test("a saved graph without them still has the connection points and the weather", async ({ page }) => {
  await page.route(/\/api\/datasets\/sim_1_modified\/graph\?.*scope=heat/, (r) => r.fulfill({ json: { source: "causal_graph.json", targets: { COP: [] } } }));
  await page.goto("/#/heat/structure");
  // the data center's water under its columns' names, the district's, the weather (no solar column: no data yet)
  for (const v of ["COP", "Q_dc", "HEX_Cond_T_in", "HEX_Cond_m", "T_dh_supply", "T_dh_return", "m_dh", "Heat_Demand", "solar_radiation"])
    await expect(instrument(page, v)).toBeVisible();
  await expect(instrument(page, "E_tank")).toHaveCount(0); // a starting variable, not a connection point: gone with the saved graph
});

test("causal discovery on the heat distribution: data columns added, linked, their lags learnt from the data center's data", async ({ page }) => {
  await page.goto("/#/heat/structure");
  await expect(instrument(page, "Q_dc")).toBeVisible();
  for (const v of ["HEX_Hall_T_in", "HEX_Hall_T_out"]) {
    await page.getByRole("button", { name: "+ Variable" }).click();
    await page.getByLabel("Variable name").fill(v);
    await page.getByLabel("Variable name").press("Enter");
    await expect(instrument(page, v)).toBeVisible();
  }
  await page.getByRole("button", { name: "+ Add link" }).click();
  await instrument(page, "HEX_Hall_T_in").click({ force: true });
  await instrument(page, "HEX_Hall_T_out").click({ force: true });
  await page.getByRole("button", { name: "+ Add link" }).click();
  await instrument(page, "Q_dc").click({ force: true });
  await instrument(page, "HEX_Hall_T_out").click({ force: true });
  await page.getByRole("button", { name: "Causal discovery" }).click();
  await page.getByRole("dialog", { name: "Causal discovery" }).getByRole("button", { name: "Run" }).click();
  const status = page.locator(".pid-status"); // the drawing's (Modelling under it has a status of its own)
  await expect(status).toContainText("Lags updated for", { timeout: 60_000 });
  await expect(status).toContainText(/\d+ skipped: variables not in the data/); // Q_dc and the starting variables have none
  // a data column on this drawing can be taken off it again: the data stays
  await instrument(page, "HEX_Hall_T_in").click({ force: true });
  await expect(page.locator("aside.pid-side")).toContainText("Data of this data center, on this drawing by choice");
  await page
    .locator("aside.pid-side")
    .getByRole("button", { name: /^Delete/ })
    .click();
  await expect(instrument(page, "HEX_Hall_T_in")).toHaveCount(0);
});

test("under the structure: Modelling, the same page as the data center's, on this graph; nothing computes by itself", async ({ page }) => {
  const computed: string[] = [];
  page.on("request", (r) => /models\/(evaluate|train)/.test(r.url()) && computed.push(r.url()));
  await page.goto("/#/heat/structure");
  await expect(instrument(page, "Q_dc")).toBeVisible();
  const below = page.getByRole("region", { name: "Modelling" });
  await below.scrollIntoViewIfNeeded();
  await expect(below.getByText("Variables · how each is made")).toBeVisible({ timeout: 30_000 }); // its first card, loaded lazily
  // the same models and buttons (each column's settings closed until it is clicked); its graph is the one drawn
  // above, with the graph file picked there
  await below.getByRole("button", { name: /^Data-driven/ }).click(); // the column opens its settings: the training
  await expect(below.getByRole("checkbox", { name: "TabPFN" })).toBeVisible();
  await expect(below.getByRole("button", { name: /^Train \d+ models?$/ })).toBeVisible();
  await expect(below.getByText("Causal graph · causal_graph.json")).toBeVisible();
  await expect(below.getByRole("group", { name: "Causal graph" }).getByRole("button", { name: "hp_load", exact: true })).toBeVisible();
  // this system's standard equations
  await below.getByRole("button", { name: /^Physical and semi-physical/ }).click(); // and the equations
  await below.getByText(/^Equation library/).click();
  await expect(below.getByRole("button", { name: /COP \(Carnot\)/ })).toBeVisible();
  await expect(below.getByRole("button", { name: /Dry cooler/ })).toHaveCount(0);
  // a link drawn above shows below at once, unsaved
  await page.getByRole("button", { name: "+ Add link" }).click();
  await instrument(page, "Out_Temp").click({ force: true }); // the weather band's T_outdoor, as the data calls it
  await instrument(page, "COP").click({ force: true });
  await expect(below.getByText("Causal graph · causal_graph.json")).toBeVisible();
  expect(computed).toEqual([]); // nothing trained or evaluated by scrolling down
});

test("the new form: on a framed data center the heat distribution and the district are boxes, their KPIs and variables", async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_box_air"));
  const svg = page.locator('svg[aria-label="P&ID with causal links"]');
  for (const [route, box, kpi, marked] of [
    ["/#/heat/structure", "Heat distribution", "COP", "Heat pump electricity · COP"],
    ["/#/district/structure", "District", "CO₂ saved", "Heat demand · Demand covered"],
  ]) {
    await page.goto(route);
    await expect(svg.locator(`g[aria-label="${box}"]`)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "KPI variables", exact: true }).click();
    const kpis = page.getByRole("list", { name: "KPIs and their variables" });
    await expect(kpis.getByRole("button", { name: kpi, exact: true })).toBeVisible();
    await expect(svg.locator("title", { hasText: marked })).toHaveCount(1);
  }
  // the CO₂ against gas says its factors
  await page.getByRole("list", { name: "KPIs and their variables" }).getByRole("button", { name: "What CO₂ saved means" }).click();
  await expect(page.getByRole("note")).toContainText("0.201 kg CO₂ per kWh of gas");
});
