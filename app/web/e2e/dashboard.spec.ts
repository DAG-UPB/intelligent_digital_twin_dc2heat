/**
 * Data Center > Dashboard (#/dc/dashboard) on sim_1_modified, read-only (the page only reads).
 * Overview and KPI cards, the sortable variables table, the time-series charts and the correlation heatmap.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

test("the dashboard shows the data, its KPIs, statistics, charts and correlations", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto("/#/dc/dashboard");
  const main = page.locator("main.app__page");

  // the data's own figures are folded (a page shows three KPIs): open them
  await main.getByRole("button", { name: "Data overview", exact: true }).click({ timeout: 30_000 }); // a tab under the KPIs
  const overview = main.locator('[aria-label="Data overview"]');
  await expect(overview.getByText("Rows", { exact: true })).toBeVisible();
  await expect(overview.getByText("Completeness", { exact: true })).toBeVisible();
  await expect(main.getByText("PUE (partial)", { exact: true })).toBeVisible();
  await expect(main.getByText("IT + cooling only · ISO/IEC 30134-2")).toBeVisible();
  // only the energy KPIs: PUE, ERF, ERE, IT energy, heat reused (of the HEX site.json hex_option selects)
  const kpis = main.locator(".dash__kpis--center .kpi__label");
  await expect(kpis).toHaveText(["PUE (partial)", "ERF", "ERE", "IT energy, total", "Heat reused, total"]);
  await expect(main.getByText(/^(condenser HEX · HEX_Cond_Q|hall HEX · HEX_Hall_Q) · \d+ % of Heat_Demand covered$/)).toBeVisible();

  // Explore's tabs: every view of the data in one card
  const tab = (name: string) => main.getByRole("radio", { name, exact: true }).click();
  // one row per variable, sortable by its headers
  await tab("Variables");
  const table = main.getByRole("table");
  const names = table.locator("tbody th .dash-table__name");
  await expect(names).toHaveCount(20); // sim_1 (11) + Heat_Demand + four columns per HEX (Q calculated)
  await table.getByRole("button", { name: /^Variable/ }).click();
  await expect(table.locator("th[aria-sort='ascending']")).toHaveCount(1);
  const sorted = await names.allTextContents();
  expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  await expect(table.getByText("heat").first()).toBeVisible();
  // the HEX heat Q stays in the table, marked calculated (Q = m·cp·ΔT, not a model target)
  await expect(table.locator("tbody tr").filter({ hasText: "calculated" }).locator(".dash-table__name")).toHaveText(["HEX_Cond_Q", "HEX_Hall_Q"]);

  // four charts to start with; a chip adds one
  await tab("Time series");
  await expect(main.locator(".dash-series .uplot")).toHaveCount(4);
  await main.getByRole("group", { name: "Variables to plot" }).getByRole("button", { name: "Out_Temp", exact: true }).click();
  await expect(main.locator(".dash-series .uplot")).toHaveCount(5);

  // 20 x 20 heatmap cells, each with its value as a title; a click shows that pair's scatter
  await tab("Correlation");
  const heatmap = main.getByRole("img", { name: /Correlation matrix of 20 variables/ });
  await expect(heatmap.locator("rect")).toHaveCount(400);
  await expect(heatmap.locator("rect title").first()).toHaveText(/In_Temp × In_Temp: r = 1,000/);
  await heatmap.locator(".dash-corr__cell").nth(3).click(); // row In_Temp, column ITE_Ener
  await expect(main.getByRole("img", { name: /Scatter of In_Temp against ITE_Ener/ })).toBeVisible();
  await main.getByRole("radio", { name: "Similar together" }).click();
  await expect(heatmap.locator("rect")).toHaveCount(400);

  expect(problems).toEqual([]);
});

test("the time series and the KPIs show the first year to start with, then a month of it or both years; the variables are picked on the left", async ({
  page,
}) => {
  await page.goto("/#/dc/dashboard");
  const panel = page.getByRole("complementary", { name: "Causal graph panel" });
  const period = panel.getByRole("combobox", { name: "Period" });
  const month = panel.getByRole("combobox", { name: "Month" });
  await expect(period).toHaveValue("2023", { timeout: 30_000 });
  const note = page.locator(".dash-series__bar > .dash__note");
  await expect(note).toHaveText(/^2023: \d+ points per variable/);
  // the KPIs follow the period
  const kpiCard = page.locator("section.card.dash__kpi-card");
  await expect(kpiCard).toContainText("Data center KPIs · 2023");
  const tiles = kpiCard.locator(".dash__kpis--center").first(); // the row, its folded figures inside
  const year = await tiles.textContent();

  await month.selectOption({ label: "Mar" });
  await expect(note).toHaveText(/^Mar 2023: \d+ points per variable \(every row\)/);
  await expect(kpiCard).toContainText("Data center KPIs · Mar 2023");
  await expect(tiles).not.toHaveText(year ?? "");
  await expect(page.locator(".dash-series .uplot")).toHaveCount(4);

  await period.selectOption({ label: "Both years" });
  await expect(note).toHaveText(/^All years \(2023–2024\): \d+ points per variable/);
  await expect(kpiCard).toContainText("Data center KPIs · All years (2023–2024)");
  await expect(month).toBeDisabled();

  // the variables: none, all, a double click shows only that one, again on the lone one all of them
  const plot = panel.getByRole("group", { name: "Variables to plot" });
  const charts = page.locator(".dash-series .uplot");
  await panel.getByRole("button", { name: "None", exact: true }).click();
  await expect(charts).toHaveCount(0);
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await expect(charts).toHaveCount(20);
  await plot.getByRole("button", { name: "In_Hum", exact: true }).dblclick();
  await expect(charts).toHaveCount(1);
  await expect(plot.getByRole("button", { name: "In_Hum", exact: true })).toHaveAttribute("aria-pressed", "true");
  await plot.getByRole("button", { name: "In_Hum", exact: true }).dblclick();
  await expect(charts).toHaveCount(20);
  await expect(panel.getByText("Click to add or remove; double-click to show only that one")).toBeVisible();
});

test("the dashboard recommends fixes, shows the weekly and monthly profiles and missing data, and previews a prepared variable", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const main = page.locator("main.app__page");
  await expect(main.getByRole("radio", { name: /^Recommendations \(\d+\)$/ })).toBeVisible({ timeout: 30_000 });

  for (const [view, picture] of [
    ["Daily profile", /Daily profile of/],
    ["Weekly and monthly", /mean by weekday and hour/],
    ["Weekly and monthly", /Monthly means/], // both in the one view
    ["Autocorrelation", /Autocorrelation of/],
  ] as const) {
    await main.getByRole("radio", { name: view }).click();
    await expect(main.getByRole("img", { name: picture })).toBeVisible();
  }
  await main.getByRole("radio", { name: "Missing data" }).click();
  await expect(main.getByText(/No variable has missing values|Red where values are missing/).first()).toBeVisible();

  // a preview only computes: nothing is written (the read-only guard would abort a write)
  await main.getByRole("radio", { name: "Edit data" }).click();
  await main.getByRole("combobox", { name: "Operation" }).selectOption("time_since_start");
  await expect(main.getByRole("textbox", { name: "New variable" })).toHaveValue("time_since_start");
  await main.getByRole("button", { name: "Preview" }).click();
  await expect(main.getByText("Values", { exact: true })).toBeVisible();
});

test("the KPI variables are chosen on the dashboard (the save is mocked: read-only)", async ({ page }) => {
  let sent: unknown = null;
  await page.route("**/api/datasets/sim_1_modified/kpi", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: sent });
  });
  await page.goto("/#/dc/dashboard");
  const main = page.locator("main.app__page");
  await main.getByText("Choose the KPI variables").click(); // folded: the simulation's names give the KPIs already
  await main.getByLabel("IT power (electricity)").selectOption("ITE_Ener");
  await main.getByLabel("Cooling power (electricity)").selectOption("HVAC_Ener");
  await main.getByLabel("Power unit").selectOption("kW");
  await main.locator("summary", { hasText: "Reused heat" }).click(); // its list folded
  await main
    .getByRole("group", { name: /Reused heat/ })
    .getByLabel("HEX_Cond_Q")
    .check();
  await main.getByRole("button", { name: "Save KPI variables" }).click();
  // what the data set had (heat demand, the alternative reuse points) is kept
  await expect
    .poll(() => sent)
    .toMatchObject({ it_power: "ITE_Ener", cooling_power: "HVAC_Ener", power_unit: "kW", heat_power: ["HEX_Cond_Q"], heat_demand: "Heat_Demand" });
});

test("a data file too big to load: its variables, then aggregate it or keep one period (mocked)", async ({ page }) => {
  const opened: string[] = [];
  await page.route("**/api/datasets/sim_1_modified/summary**", (r) => {
    opened.push(new URL(r.request().url()).searchParams.get("file") ?? "");
    return r.fulfill({ status: 422, json: { detail: "big.csv is 2.3 GB of CSV: too big to load within the app's memory (limit 200 MB)." } });
  });
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  for (const what of ["window", "resampled"])
    await page.route(`**/api/datasets/sim_1_modified/${what}`, (r) => {
      sent.push({ url: what, body: r.request().postDataJSON() });
      return r.fulfill({ json: { did: `made it (${what})`, step: null, recipe: [], files: [] } });
    });
  await page.goto("/#/dc/dashboard");
  const card = page.getByRole("region", { name: "Keep one period" });
  await expect(page.getByText("is too big to load here")).toBeVisible();
  await expect(page.getByText(/Variables kept \(20 of 20\)/)).toBeVisible();
  await page
    .getByRole("group", { name: /Variables kept/ })
    .getByLabel("Hour")
    .uncheck();

  await card.getByLabel("From").fill("2023-01-02T00:00");
  await card.getByLabel("Up to").fill("2023-01-03T00:00");
  await card.getByRole("button", { name: /Load this period \(19 variables\)/ }).click();
  await expect.poll(() => sent[0]?.body).toMatchObject({ start: "2023-01-02T00:00", end: "2023-01-03T00:00" });
  expect((sent[0].body.columns as string[]).length).toBe(19);
  await expect.poll(() => opened.at(-1)).toBe("df_sim_1_modified__20230102-20230103"); // the new file is opened

  await page.reload();
  await page
    .getByRole("group", { name: /Variables kept/ })
    .getByLabel("Hour")
    .uncheck();
  await page
    .getByRole("region", { name: "Aggregate the file" })
    .getByRole("button", { name: /Aggregate 19 variables/ })
    .click();
  await expect.poll(() => sent[1]?.body).toMatchObject({ step: "1d", default: "mean", methods: { Hour: "drop" } }); // hourly data: 1 day is the first coarser step
});

test("the groups marked on the Physical structure page are listed, and their members marked (site.json mocked)", async ({ page }) => {
  await page.route("**/api/datasets/sim_1_modified/site", async (r) => {
    const site = await (await r.fetch()).json();
    await r.fulfill({ json: { ...site, pid_notes: { In_mean: { group: { method: "mean", members: ["In_Hum", "In_Temp"] } } } } });
  });
  await page.goto("/#/dc/dashboard");
  const main = page.locator("main.app__page");
  await main.getByRole("radio", { name: "Variables", exact: true }).click({ timeout: 30_000 });
  await expect(main.getByText("Groups (1)", { exact: true })).toBeVisible();
  await expect(main.getByRole("row", { name: /^In_mean/ })).toContainText("2: In_Hum, In_Temp");
  await expect(main.getByRole("row", { name: /^In_Temp/ }).getByText("in In_mean")).toBeVisible();
});

test("Historical or Scenarios: in Scenarios the levers appear and the KPIs follow the twin; nothing runs before a lever moves", async ({ page }) => {
  const runs: string[] = [];
  page.on("request", (r) => r.url().includes("/simulate") && runs.push(r.url()));
  await page.goto("/#/dc/dashboard");
  const mode = page.getByRole("radiogroup", { name: "Mode" });
  await expect(mode.getByRole("radio", { name: "Historical" })).toHaveAttribute("aria-checked", "true", { timeout: 60_000 });
  await expect(page.locator("section.card", { hasText: "Data center KPIs" }).first()).toBeVisible();
  await expect(page.getByRole("slider", { name: /shifted by/ })).toHaveCount(0); // no levers in Historical
  await mode.getByRole("radio", { name: "Scenarios" }).click();
  await expect(page.locator(".dash--scenario")).toBeVisible();
  const card = page.locator("section.card", { hasText: "scenario: move a lever" });
  await expect(card.getByText("Move a lever to see how the KPIs change.")).toBeVisible({ timeout: 60_000 });
  expect(runs).toEqual([]);
  await card.getByRole("slider").first().focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  // the result in the KPI tiles on top: the twin with the levers, measured, without and the change beside it
  const tiles = page.getByLabel("KPIs of the scenario");
  await expect(tiles.getByText("PUE (partial)")).toBeVisible({ timeout: 60_000 });
  await expect(tiles).toContainText("twin, no change");
  await expect(tiles).toContainText("change ");
  expect(runs.length).toBeGreaterThan(0);
  await card.getByRole("button", { name: "Reset" }).click();
  await expect(tiles).toHaveCount(0);
  // the Scenarios page's tools in place of the measured charts: replay and simulation, with the variables to pick
  const tools = page.getByRole("region", { name: "Replay and simulation" });
  await expect(tools.getByRole("tab", { name: "Step-through (replay)" })).toBeVisible({ timeout: 30_000 });
  await expect(tools.getByRole("tab", { name: "Long period simulation" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Correlation", exact: true })).toHaveCount(0);
  await mode.getByRole("radio", { name: "Historical" }).click();
  await expect(page.locator(".dash--scenario")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Correlation", exact: true })).toBeVisible();
});

test("the heat distribution's own Visualization and Scenarios: its variables and KPIs; in Scenarios the KPIs stay and follow its twin", async ({ page }) => {
  // its twin (scope heat) mocked: no heat model is trained in the example data, and training would write
  const model = {
    name: "linear",
    file: "linear.json",
    graph_file: "causal_graph.json",
    order: ["HEX_Hall_Q"],
    drivers: ["HEX_Hall_T_in"],
    variables: {},
    max_lag: 1,
    split_index: 10,
    split_time: null,
    rows: 14,
  };
  const run = (q: number) => ({ HEX_Hall_Q: [q, q, q, q], HEX_Hall_T_in: [35, 35, 35, 35], HEX_Cond_Q: [5, 5, 5, 5], HEX_Cond_T_in: [30, 30, 30, 30] });
  await page.route(/\/models\?scope=heat$/, (r) => r.fulfill({ json: { models: ["linear"] } }));
  await page.route(/\/models\/linear\?scope=heat$/, (r) => r.fulfill({ json: model }));
  await page.route(/\/models\/linear\/simulate\?scope=heat$/, (r) =>
    r.fulfill({ json: { start: 10, steps: 4, time: ["a", "b", "c", "d"], actual: run(10), baseline: run(10), scenario: run(20) } }),
  );
  await page.goto("/#/heat/dashboard");
  const main = page.locator("main.app__page");
  const kpis = main.locator(".dash__kpi-card .dash__kpis--center .kpi__label"); // the KPIs, not the data overview under them
  await expect(kpis.first()).toHaveText("Heat recovered", { timeout: 30_000 });
  // the tiles whose variables the data has (the example has no heat pump: no empty tiles for it, audit P12)
  await expect(kpis).toHaveText(["Heat recovered", "Mean source temperature"]);
  const tiles = main.locator(".dash__kpi-card .dash__kpis--center .kpi");
  // the hall or the condenser: two designs of the same plant, the heat of one only (their sum would double it)
  await expect(tiles.first()).toContainText("Σ HEX_Hall_Q × Δt (at the hall; condenser: another design)");
  // the others named under them, with what they need
  await expect(main.getByText("Not shown, their variables are not in the data:")).toContainText("COP (needs Q_hp, P_el_hp)");
  // only its own variables: the heat exchangers', not the data center's
  await main.getByRole("radio", { name: "Variables", exact: true }).click(); // the variables table, in its tab
  await expect(main.getByRole("row", { name: /^HEX_Hall_Q/ }).first()).toBeVisible();
  await expect(main.getByRole("row", { name: /^ITE_Ener/ })).toHaveCount(0);

  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Scenarios" }).click();
  await expect(kpis.first()).toHaveText("Heat recovered"); // the KPIs stay
  const card = page.locator("section.card", { hasText: "scenario: move a lever" });
  await card.getByRole("slider", { name: /HEX_Hall_T_in/ }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  const played = main.getByLabel("KPIs of the scenario");
  await expect(played.getByText("Heat recovered", { exact: true })).toBeVisible({ timeout: 30_000 }); // and follow the twin
  await expect(played.locator(".kpi", { hasText: "Heat recovered" })).toContainText("twin, no change");
  await card.getByRole("button", { name: "Reset" }).click();
  await expect(played).toHaveCount(0);
});

test("a distribution opens large on a click: its bars' ranges and rows, its statistics; Escape closes it", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  await page.getByRole("radio", { name: "Distributions", exact: true }).click({ timeout: 30_000 });
  const dist = page.locator(".dash-dist").filter({ hasText: "Out_Temp" }).first();
  await dist.click({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: "Distribution of Out_Temp" });
  await expect(dialog.locator(".dash-hist--big rect")).toHaveCount(20);
  await expect(dialog.locator(".dash-hist--big rect title").first()).toHaveText(/ … .*: [\d.]+ rows$/);
  await expect(dialog.getByText("median", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await dist.focus();
  await page.keyboard.press("Enter"); // by keyboard too
  await expect(dialog).toBeVisible();
});

test("the time series as rows or as tiles side by side; the choice is kept", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const list = page.locator(".dash-series__list");
  await expect(list.locator(".uplot").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: "Tiles" }).click();
  await expect(list).toHaveClass(/dash-series__list--tiles/);
  await expect(list.locator(".uplot").nth(1)).toBeVisible();
  // side by side: both measured at once, once the layout has settled (the fonts still loading move them)
  const apart = () =>
    list.evaluate((l) => {
      const [a, b] = [...l.querySelectorAll(".uplot")].map((e) => e.getBoundingClientRect().y);
      return Math.abs(a - b);
    });
  await expect.poll(apart).toBeLessThan(2);
  await page.reload();
  await expect(page.locator(".dash-series__list--tiles")).toBeVisible({ timeout: 30_000 });
});

test("on the other views the variables stay on the left: a click shows that one", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  await page.getByRole("radio", { name: "Weekly and monthly" }).click({ timeout: 30_000 });
  const pick = page.getByRole("group", { name: "Variable to show" });
  await pick.getByRole("button", { name: "Out_Temp", exact: true }).click();
  await expect(page.getByLabel("Variable", { exact: true })).toHaveValue("Out_Temp");
  await expect(pick.getByRole("button", { name: "Out_Temp", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("leaving the page and coming back shows it as it was left: the tab and the variables picked", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const main = page.locator("main.app__page");
  await expect(main.locator(".dash-series .uplot")).toHaveCount(4, { timeout: 30_000 });
  await main.getByRole("group", { name: "Variables to plot" }).getByRole("button", { name: "Out_Temp", exact: true }).click();
  await expect(main.locator(".dash-series .uplot")).toHaveCount(5);
  await main.getByRole("radio", { name: "Correlation", exact: true }).click();
  await main.getByRole("radio", { name: "Time series", exact: true }).click();
  await page.goto("/#/dc/structure"); // another page, then back (no reload)
  await page.goto("/#/dc/dashboard");
  await expect(main.locator(".dash-series .uplot")).toHaveCount(5, { timeout: 30_000 });
  await main.getByRole("radio", { name: "Correlation", exact: true }).click();
  await page.goto("/#/twin/matching");
  await page.goto("/#/dc/dashboard");
  await expect(main.getByRole("img", { name: /Correlation matrix of 20 variables/ })).toBeVisible({ timeout: 30_000 });
});
