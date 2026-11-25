/**
 * Data Center › Structure and Modelling, scrolled down to Modelling, read-only: settings, variables, physics equations
 * and the library, results, and the graph file shared with the structure above. The results come first; the
 * modelling window (Model…) opens above them, by itself when there are none yet.
 * Nothing is trained or saved (Train is never pressed). Run against a running app: `E2E_BASE_URL=… npm run e2e`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

test("Modelling: settings, variables and equations respond; results load when asked", async ({ page }) => {
  test.setTimeout(300_000); // a cold TabPFN free run takes ~1 min on the first evaluation after a restart
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  page.on("request", (r) => {
    // nothing may even try to train or save (readOnly aborts it; equation checks are a POST but change nothing)
    if (r.method() !== "GET" && /\/models\/train|\/equations$/.test(r.url())) problems.push(`write: ${r.method()} ${r.url()}`);
  });

  await page.goto("/#/dc/train"); // the old address: Structure and Modelling
  const m = page.getByRole("region", { name: "Modelling" });
  await m.scrollIntoViewIfNeeded();
  await expect(m.getByText("Variables · how each is made")).toBeVisible({ timeout: 30_000 }); // its first card
  // nothing evaluated nor stored: the modelling window opened by itself
  await expect(m.getByRole("button", { name: "Model…" })).toHaveAttribute("aria-expanded", "true");
  // the saved models restore the settings (split, variables) and then their graph fills the map: wait for that, else
  // a restore arriving late (a busy backend in the full run) undoes the edits below
  const map = m.getByRole("group", { name: "Causal graph" });
  await expect(map.getByRole("button", { name: "HEX_Cond_T_out", exact: true })).toBeVisible({ timeout: 60_000 });

  // settings: closed until the Data-driven column is clicked; unticking kinds/structures changes the count on the Train button
  await m.getByRole("button", { name: /^Data-driven/ }).click();
  const train = m.getByRole("button", { name: /^Train \d+ models?$/ });
  await expect(train).toHaveText("Train 7 models");
  await m.getByRole("group", { name: "Structure" }).getByLabel("All vs all").uncheck();
  await expect(train).toHaveText("Train 5 models");
  await m.getByRole("group", { name: "Model" }).getByLabel("TabPFN").uncheck();
  await expect(train).toHaveText("Train 4 models");

  // the split slider moves the "Train until" date
  const split = m.getByLabel(/^Train until/);
  await split.fill("0.3");
  await expect(m.getByText(/Train until \d{4}-\d{2}-\d{2} \(30%\)/)).toBeVisible();

  // variables: None moves every data column to Not modelled, Select all back; the data center's start data-driven
  const notModelled = m.getByRole("region", { name: "Not modelled", exact: true });
  await m.getByRole("button", { name: "None", exact: true }).click();
  await expect(notModelled.locator('[data-var="In_Temp"]')).toBeVisible();
  await m.getByRole("button", { name: "Select all" }).click();
  await expect(notModelled.locator('[data-var="In_Temp"]')).toHaveCount(0);
  await expect(m.getByLabel("Approach of In_Temp")).toHaveValue("data");
  await expect(m.getByLabel(/ from data$/)).toHaveCount(0);
  // the HEX heat Q is calculated: listed, but never a model variable (no approach to pick)
  const q = m.locator(".train-var").filter({ hasText: "HEX_Cond_Q" });
  await expect(q).toContainText("calculated");
  await expect(q.getByRole("combobox")).toHaveCount(0);
  await expect(m.getByLabel("Approach of HEX_Cond_T_out")).toHaveValue("data");

  // the causal graph of the selected file sits on the left: the selected HEX only, no calculated Q; a click finds the variable
  await expect(map.getByRole("button", { name: "HEX_Cond_Q", exact: true })).toHaveCount(0);
  await map.getByRole("button", { name: "In_Temp", exact: true }).click();
  await expect(m.locator(".train-var--picked")).toHaveText(/In_Temp/);
  // and the other way: a click on a variable picks it on the map
  await m.locator('.train-var[data-var="ITE_Ener"]').click();
  await expect(m.locator(".train-var--picked")).toHaveText(/ITE_Ener/);

  // physics: add a row, add a constant, then remove the row again (only local state)
  // (the data center's variables start data-driven: an added equation moves its variable to Physical)
  // each column's settings open under the columns, one at a time: the equations by a click on the Physical column
  await m.getByRole("button", { name: /^Physical and semi-physical/ }).click();
  const rows = m.getByRole("textbox", { name: /^Equation for / });
  const before = await rows.count();
  await m.getByRole("button", { name: "+ Add equation" }).click();
  await expect(rows).toHaveCount(before + 1);
  await m.getByRole("button", { name: "+ constant to learn" }).last().click();
  await expect(rows.last()).toHaveValue(/(^| \+ )c\d+$/);
  await m.getByRole("button", { name: /^Remove the equation for / }).last().click();
  await expect(rows).toHaveCount(before);

  // library: open it, pick a component, fix a coefficient, cancel
  await m.getByText("Equation library · click a component").click();
  await m.getByRole("button", { name: /Heat recovered from IT/ }).click();
  const placing = m.getByRole("region", { name: "Place: Heat recovered from IT" });
  await expect(placing).toBeVisible();
  await placing.getByLabel("eta: learn or fix").selectOption("fixed");
  await expect(placing.locator("code").last()).toContainText("0.8 *");
  await placing.getByRole("button", { name: "Cancel" }).click();
  await expect(placing).toHaveCount(0);

  // results of the saved models: evaluated only when asked (it can take a minute the first time)
  await expect(m.getByText("Results · causal graph vs all vs all")).toHaveCount(0);
  await m.getByRole("button", { name: "Evaluate on the test period" }).click();
  await expect(m.getByText("Results · causal graph vs all vs all")).toBeVisible({ timeout: 240_000 });
  await expect(m.getByText("Structural equations · best model per variable")).toBeVisible();
  await expect(m.locator(".train-table tbody tr").first()).toBeVisible();
  const windowSelect = m.getByLabel("Window after a setpoint change");
  if (await windowSelect.count()) {
    await windowSelect.selectOption("12");
    await expect(m.getByText(/^Evaluating \d+ models? on the test period/)).toHaveCount(0, { timeout: 120_000 });
    await expect(windowSelect).toHaveValue("12");
  }
  await m.getByRole("button", { name: /^Data-driven/ }).click(); // back from the equations to the training
  await expect(train).toBeEnabled();
  expect(problems).toEqual([]);
});

test("Modelling of the example: the stored evaluation at once, a picked variable's results and equation, a column's, Inspect", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_recovery_air")); // after beforeEach's: this one wins
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  const evaluated: string[] = [];
  page.on("request", (r) => /\/models\/evaluate/.test(r.url()) && evaluated.push(r.url()));

  // a variable selected on the drawing is picked below too: its results on top
  await page.goto("/#/dc/pid");
  await page.locator('svg[aria-label="P&ID with causal links"] g:has(> text:text-is("Loop_T_warm")) > circle').click({ force: true, timeout: 60_000 });
  const m = page.getByRole("region", { name: "Modelling" });
  await m.scrollIntoViewIfNeeded();
  await expect(m.getByRole("region", { name: "Results of Loop_T_warm" }).locator("tbody tr")).toHaveCount(6, { timeout: 60_000 });

  // the example is modelled and its evaluation stored: the results show without Evaluate, the modelling window closed
  await expect(m.getByText("Results · causal graph vs all vs all")).toBeVisible();
  await expect(m.getByText(/^The stored evaluation of the 6 saved models/)).toBeVisible();
  await expect(m.getByRole("button", { name: "Evaluate again" })).toBeVisible();
  const model = m.getByRole("button", { name: "Model…" });
  await expect(model).toHaveAttribute("aria-expanded", "false");
  await expect(m.getByText("Variables · how each is made")).toBeHidden();

  // picked in the results table: its row marked, every saved model of it (the best first and marked), and its
  // equation marked in the structural equations' box, scrolled to inside it
  await m.locator(".train-table--pick").getByRole("button", { name: "HEX_Hall_T_out", exact: true }).click();
  await expect(m.locator(".train-table__picked")).toContainText("HEX_Hall_T_out");
  const picked = m.getByRole("region", { name: "Results of HEX_Hall_T_out" });
  await expect(picked.locator("tbody tr")).toHaveCount(6);
  await expect(picked.locator("tbody tr").first()).toContainText("best");
  await expect(picked.getByRole("columnheader", { name: "R²" })).toBeVisible();
  const equations = m.getByRole("region", { name: "Structural equations" });
  await expect(equations.locator(".train-struct__var--picked strong")).toHaveText("HEX_Hall_T_out");
  await expect.poll(() => equations.locator(".train-struct__list").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  // Model… opens the modelling window above the results, remembered in this browser
  await model.click();
  await expect(model).toHaveAttribute("aria-expanded", "true");
  await expect(m.getByText("Variables · how each is made")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("modelling-window-open"))).toBe("1");
  await expect(m.locator(".train-var--picked")).toHaveText(/HEX_Hall_T_out/); // picked in the columns too
  // an input and a calculated column say why they have none
  await m.locator('.train-var[data-var="Out_Temp"]').click();
  await expect(m.getByRole("region", { name: "Results of Out_Temp" })).toContainText("An input taken from the data");
  await m.locator('.train-var[data-var="HEX_Hall_Q"]').click();
  await expect(m.getByRole("region", { name: "Results of HEX_Hall_Q" })).toContainText("Calculated from other variables");

  // the Data-driven column's settings list each of its variables with its best data-driven model; a name picks it
  const column = m.getByRole("button", { name: /^Data-driven/ });
  await column.click();
  const list = m.getByRole("region", { name: "Results of the Data-driven column" });
  // one row per variable of the column, as many as its head counts (the example's variables change with its generator)
  const count = Number((await column.textContent())?.match(/\d+/)?.[0]);
  expect(count).toBeGreaterThan(0);
  await expect(list.locator("tbody tr")).toHaveCount(count);
  await list.getByRole("button", { name: "HVAC_Ener", exact: true }).click();
  await expect(m.getByRole("region", { name: "Results of HVAC_Ener" })).toBeVisible();
  await expect(m.locator(".train-var--picked")).toHaveText(/HVAC_Ener/);
  // Inspect: the fit up close
  await list.getByRole("button", { name: /^Inspect HEX_Hall_m · / }).click();
  const fit = page.getByRole("dialog", { name: /^Fit of HEX_Hall_m · / });
  await expect(fit.getByRole("img", { name: /^Predicted vs measured HEX_Hall_m/ })).toBeVisible({ timeout: 60_000 });
  await fit.getByRole("button", { name: "Close" }).click();
  await expect(fit).toHaveCount(0);
  expect(evaluated).toEqual([]); // nothing evaluated: the stored evaluation
  expect(problems).toEqual([]);
});

test("Modelling follows the structure above: one graph file for both, picked in either", async ({ page }) => {
  await page.goto("/#/dc/pid");
  const above = page.getByRole("combobox", { name: "Graph file" });
  await expect(above).toBeEnabled({ timeout: 30_000 });
  const m = page.getByRole("region", { name: "Modelling" });
  await m.scrollIntoViewIfNeeded();
  await m.getByRole("button", { name: /^Data-driven/ }).click({ timeout: 30_000 }); // its settings hold the graph file
  const below = m.getByRole("combobox", { name: "Causal graph" });
  await expect(below).toHaveValue(await above.inputValue(), { timeout: 30_000 });
  const files = await above.locator("option").allTextContents();
  const next = files.find((f) => f !== files[0]) ?? files[0];
  await above.selectOption(next);
  await expect(below).toHaveValue(next);
  await below.selectOption(files[0]);
  await expect(above).toHaveValue(files[0]);
});

test("Connection points: what each part delivers, how each variable is made, the shared weather", async ({ page }) => {
  const ports = page.getByRole("region", { name: "Connection points" });
  // each point folds on its title (open only when something is missing): open them all to read their boxes
  const openAll = async () => {
    const closed = ports.locator("details.ports__point:not([open]) > summary"); // shrinks as each one opens
    while (await closed.count()) await closed.first().click();
  };
  for (const [route, points] of [
    ["/#/dc/pid", ["Hall HEX · hot-aisle air", "Condenser HEX · cooling water"]],
    ["/#/heat/structure", ["From the data center · waste heat", "To the district · district heat"]],
    ["/#/district/structure", ["District heat · demand"]],
  ] as const) {
    await page.goto(route);
    await page.locator(".pid-below").scrollIntoViewIfNeeded();
    await expect(ports).toBeVisible({ timeout: 60_000 });
    // each point's name on its own line, what it is about under it
    for (const p of [...points, "Weather"]) await expect(ports.getByText(p, { exact: true })).toBeVisible();
    await expect(ports.getByText("needed for the twin").first()).toBeVisible();
    await expect(ports.getByText("shared by all three parts")).toBeVisible();
  }
  // the district's: the demand starts as a profile, the network temperatures are the Site map's, the weather measured
  await openAll();
  await expect(ports.getByRole("button", { name: "Heat: Heat_Demand, profile" })).toBeVisible();
  await expect(ports.getByRole("button", { name: "Supply temperature: T_dh_supply, setting" })).toBeVisible();
  await expect(ports.getByRole("button", { name: "Outdoor temperature: Out_Temp, measured" })).toBeVisible();
  // the data center's: the HEX heat is calculated, the rest learned from the data; a click finds it under Variables
  await page.goto("/#/dc/pid");
  await page.locator(".pid-below").scrollIntoViewIfNeeded();
  await expect(ports.getByText("shared by all three parts")).toBeVisible({ timeout: 60_000 });
  await openAll();
  await expect(ports.getByRole("button", { name: "Heat: HEX_Cond_Q, calculated" })).toBeVisible();
  await ports.getByRole("button", { name: "Return temperature: HEX_Cond_T_out, data-driven" }).click();
  await expect(page.locator('.train-var--picked[data-var="HEX_Cond_T_out"]')).toBeVisible();
});

test("KPI variables: the data center's bound variables, the KPIs they feed, saved (mocked: read-only)", async ({ page }) => {
  let sent: unknown = null;
  await page.route("**/api/datasets/sim_1_modified/kpi", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: sent });
  });
  await page.goto("/#/dc/pid");
  await page.locator(".pid-below").scrollIntoViewIfNeeded();
  const kpi = page.getByRole("region", { name: "KPI variables" });
  // folded at first, its title saying what PUE uses; a click opens it (remembered)
  await expect(kpi.locator(".kpi-vars__line")).toHaveText("PUE = (ITE_Ener + HVAC_Ener) / ITE_Ener", { timeout: 60_000 });
  await expect(kpi.getByLabel("IT power", { exact: true })).toBeHidden();
  await kpi.getByText("KPI variables · what PUE, ERF and ERE use").click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("kpi-variables-open"))).toBe("1"); // the toggle event comes a moment later
  // what the KPIs use now: dataset.json "kpi", the reused heat the condenser point's (site.json hex_option)
  await expect(kpi.getByLabel("IT power", { exact: true })).toHaveValue("ITE_Ener");
  await expect(kpi.getByLabel("Reused heat 1")).toHaveValue("HEX_Cond_Q");
  const formulas = kpi.getByRole("list", { name: "KPI formulas" });
  await expect(formulas).toContainText("PUE ⓘ (ITE_Ener + HVAC_Ener) / ITE_Ener");
  await formulas.getByRole("button", { name: "What PUE means" }).click(); // its info mark opens on a click
  await expect(formulas.getByRole("note")).toContainText("Power Usage Effectiveness");
  await formulas.getByRole("button", { name: "What PUE means" }).click();
  await expect(formulas.getByRole("note")).toHaveCount(0);
  await kpi.getByLabel("Add a reused heat").selectOption("HEX_Hall_Q");
  await expect(formulas).toContainText("ERF ⓘ (HEX_Cond_Q + HEX_Hall_Q) / (ITE_Ener + HVAC_Ener)");
  await kpi.getByLabel("Cooling power", { exact: true }).selectOption("");
  await expect(formulas).toContainText("PUE ⓘ needs cooling power");
  await kpi.getByLabel("Cooling power", { exact: true }).selectOption("HVAC_Ener");
  await kpi.getByRole("button", { name: "Save KPI variables" }).click();
  await expect
    .poll(() => sent)
    .toMatchObject({
      it_power: "ITE_Ener",
      cooling_power: "HVAC_Ener",
      heat_power: ["HEX_Cond_Q", "HEX_Hall_Q"],
      heat_demand: "Heat_Demand",
      power_unit: "kW",
    });
  await expect(kpi.getByRole("status")).toHaveText("Saved: the KPIs are computed from these.");
  // the heat distribution's Modelling has none: the KPIs are the data center's
  await page.goto("/#/heat/structure");
  await page.locator(".pid-below").scrollIntoViewIfNeeded();
  await expect(page.getByRole("region", { name: "Connection points" })).toBeVisible({ timeout: 60_000 });
  await expect(kpi).toHaveCount(0);
});
