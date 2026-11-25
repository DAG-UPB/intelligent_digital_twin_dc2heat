/**
 * Heat Matching (#/heat/flow, now #/twin/matching) on sim_1_modified: the three columns with supply and
 * return, extraction points, window navigation, each part's Model or Calculation, the physics source, and the on/off
 * units of the heat distribution. Read-only: writes are aborted (readonly.ts); the switches' site.json save is mocked here.
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/heat.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
  await page.goto("/#/heat/flow");
  await expect(diagram(page)).toBeVisible({ timeout: 60_000 });
  await openMore(page); // under each part's box only its Model or Calculation; the rest opens on a click
});

const diagram = (page: Page) => page.getByRole("group", { name: /Heat flow from the data center/ });
const logic = (page: Page, part: string) => page.getByRole("radiogroup", { name: `${part} source` });
const card = (page: Page, title: string) => page.locator(".heat-cards section.card", { has: page.getByText(title, { exact: true }) });
const openMore = async (page: Page) => {
  for (const m of await page.locator(".heat-cards summary", { hasText: "More options" }).all()) await m.click();
};
/** The open More options panels closed: they lie over what follows (What if…, its Run scenario). */
const closeMore = async (page: Page) => {
  const open = page.locator(".heat-cards details[open] > summary", { hasText: "More options" }); // what is open inside stays open
  while ((await open.count()) > 0) await open.first().click();
};
/** Run scenario, clear of the More options panels, which open again after it. */
const run = async (page: Page) => {
  await closeMore(page);
  await page.getByRole("button", { name: "Run scenario" }).click();
  await openMore(page);
};
const settings = (page: Page, title: string) => card(page, title).locator("summary", { hasText: "Settings" }).click();

test("three columns, and the connections as supply / return pairs with temperatures", async ({ page }) => {
  for (const head of ["Data center", "Heat distribution", "District"]) await expect(diagram(page).locator(".hf-dc-title", { hasText: head })).toBeVisible(); // the boxes' titles
  for (const part of ["Direct heat exchanger", "Thermal storage", "Heat pump"]) await expect(diagram(page).getByText(part, { exact: true })).toBeVisible();
  await expect(diagram(page).locator(".hf-temp").first()).toContainText("°C");
  // the simulation measures the HEX outlet: no assumed return; the physics source assumes one (≈)
  await expect(diagram(page).locator(".hf-temp", { hasText: "≈" })).toHaveCount(0);
  await logic(page, "Data center").getByRole("radio", { name: "Calculation" }).click();
  await expect(diagram(page).locator(".hf-temp", { hasText: "≈" }).first()).toBeVisible();
});

test("the shared weather over the parts, and the mass flow on the pipes follows the water's cp", async ({ page }) => {
  await expect(diagram(page).getByRole("button", { name: /Weather, shared by all three parts: Outdoor -?\d/ })).toBeVisible();
  // the district pipe: ṁ = Q / (cₚ · ΔT); half the cₚ doubles it
  // the pipe shows only its heat; its mass flow is in its hover text
  const toDistrict = diagram(page).locator(".hf-flow-label").last();
  await expect(toDistrict.locator("tspan")).toHaveText(/^[\d.,]+ [kM]W$/);
  const flow = async () => Number((await toDistrict.locator("title").textContent())!.match(/([\d.]+) kg\/s/)![1]);
  const before = await flow();
  await settings(page, "Heat distribution");
  await card(page, "Heat distribution")
    .getByRole("spinbutton", { name: /Heat capacity/ })
    .fill("2.09");
  // shown in whole kg/s: twice a rounded value is off by up to 1
  await expect.poll(async () => Math.abs((await flow()) - before * 2)).toBeLessThanOrEqual(1);
});

test("the data center's Model is its drawing, its heat exchangers to pick, linked to its Structure and Modelling", async ({ page }) => {
  const thumb = diagram(page).getByRole("link", { name: "The data center's Structure and Modelling" });
  await expect(thumb).toBeVisible();
  await expect(diagram(page).locator(".hf-pick")).toHaveCount(2); // the hall's and the condenser's heat exchanger
  await expect(diagram(page).locator(".hf-point")).toHaveCount(0); // no point boxes
  await logic(page, "Data center").getByRole("radio", { name: "Calculation" }).click();
  await expect(thumb).toHaveCount(0);
  await expect(diagram(page).locator(".hf-pick")).toHaveCount(0);
  await expect(diagram(page).locator(".hf-point")).toHaveCount(2);
  await logic(page, "Data center").getByRole("radio", { name: "Model" }).click();
  await thumb.click();
  await expect(page).toHaveURL(/#\/dc\/pid$/);
});

test("in every mix of Model and Calculation the pipes stay between the columns, under the weather", async ({ page }) => {
  await page.route("**/api/datasets/sim_1_modified/site", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const res = await r.fetch();
    return r.fulfill({ response: res, json: { ...(await res.json()), heat_components: { hex: "hex_approach" } } }); // its Model is offered
  });
  await page.reload();
  await expect(diagram(page)).toBeVisible({ timeout: 60_000 });
  const parts = ["Data center", "Heat distribution", "District"];
  for (let mix = 0; mix < 8; mix++) {
    for (const [i, part] of parts.entries())
      await logic(page, part)
        .getByRole("radio", { name: mix & (1 << i) ? "Calculation" : "Model" })
        .click();
    // every pipe runs under the columns' titles (y 90 of the columns' group): none goes up into the weather band
    await expect
      .poll(() => diagram(page).evaluate((svg) => Math.min(...[...svg.querySelectorAll<SVGGraphicsElement>(".hf-flow")].map((p) => p.getBBox().y))), {
        message: `mix ${mix}`,
      })
      .toBeGreaterThan(90);
  }
});

test("the extraction point is picked by click and by keyboard", async ({ page }) => {
  const hall = page.getByRole("radio", { name: /Extract at Hall HEX/ });
  const condenser = page.getByRole("radio", { name: /Extract at Condenser HEX/ });
  await expect(condenser).toHaveAttribute("aria-checked", "true"); // the default
  await hall.click(); // a what-if: drawn at once, run with the others
  await expect(hall).toHaveAttribute("aria-checked", "true");
  await run(page);
  await expect(page.getByText("Hall HEX · hot-aisle air", { exact: true }).and(page.locator(":not(option)"))).toBeVisible(); // not the what-if's select
  await condenser.focus();
  await page.keyboard.press("Enter");
  await expect(condenser).toHaveAttribute("aria-checked", "true");
});

test("the window moves with the buttons and the slider", async ({ page }) => {
  const label = page.locator(".heat-winnav__label");
  await expect(label).toHaveText(/^W3 · /);
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(label).toHaveText(/^W4 · /);
  await expect(page.locator(".twin-year .heat-meta").first()).toContainText(/^week 4 ·/); // the heat flow's window, named over the year
  await page.getByRole("button", { name: "Previous week" }).click();
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(label).toHaveText(/^W2 · /);
  await page.getByRole("slider", { name: "week", exact: true }).fill("0"); // the one under the chart (the heat flow has its own: "week of the year")
  await expect(label).toHaveText(/^W1 · /);
  await expect(page.getByText(/COP this week ⌀/)).toBeVisible();
});

test("the physics source shows its formula, its settings and the Model next to it", async ({ page }) => {
  await logic(page, "Data center").getByRole("radio", { name: "Calculation" }).click();
  await expect(page.getByText(/Q = η · \(ITE_Ener \+ HVAC_Ener\)/)).toBeVisible();
  await expect(page.getByRole("slider", { name: /Tower approach/ })).toBeHidden(); // folded
  await settings(page, "Data center");
  await expect(page.getByRole("slider", { name: /Tower approach/ })).toBeVisible();
  const compare = page.getByRole("switch", { name: "Compare with the Model" });
  await expect(compare).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".u-legend", { hasText: "District demand" }).first()).toContainText("DC heat · model");
  await compare.click();
  await expect(compare).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".u-legend", { hasText: "District demand" }).first()).not.toContainText("DC heat · model");
  await page.getByRole("radio", { name: /Extract at Hall HEX/ }).click();
  await run(page);
  await expect(page.getByRole("slider", { name: /Rack ΔT/ })).toBeVisible();
});

test("every part runs its Model or the Calculation; the Model says where it comes from", async ({ page }) => {
  for (const part of ["Data center", "Heat distribution", "District"])
    await expect(logic(page, part).getByRole("radio")).toHaveText(["Model", "Calculation"]);
  await expect(logic(page, "Data center").getByRole("radio", { name: "Model" })).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "Data center").getByRole("link", { name: /Data Center › Structure and Modelling/ })).toBeVisible();
  // no plant model picked: the heat distribution runs the Calculation and says why
  await expect(logic(page, "Heat distribution").getByRole("radio", { name: "Model" })).toBeDisabled();
  await expect(logic(page, "Heat distribution").getByRole("radio", { name: "Calculation" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Model: no model yet: train one, or pick its plant models/)).toBeVisible();
  // the district's Model: the profile its Modelling gives the demand (it starts as one); Calculation: the Site map's sinks
  await expect(logic(page, "District").getByRole("radio", { name: "Model" })).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "District").getByText(/The profile of Heat_Demand/)).toBeVisible();
  await logic(page, "District").getByRole("radio", { name: "Calculation" }).click();
  await expect(card(page, "District").getByText(/Generated from the heat sinks/)).toBeVisible();
});

test("the heat distribution's Model: the plant models picked under its Structure and Modelling", async ({ page }) => {
  await page.route("**/api/datasets/sim_1_modified/site", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const res = await r.fetch();
    return r.fulfill({ response: res, json: { ...(await res.json()), heat_components: { hex: "hex_approach" } } });
  });
  await page.reload();
  await expect(diagram(page)).toBeVisible({ timeout: 60_000 });
  await expect(logic(page, "Heat distribution").getByRole("radio", { name: "Model" })).toHaveAttribute("aria-checked", "true");
  await openMore(page);
  await expect(card(page, "Heat distribution").getByText("Direct heat exchanger (approach)")).toBeVisible();
  await expect(card(page, "Heat distribution").getByText(/Heat pump: built-in formula/)).toBeVisible();
});

test("the heat distribution's units switch off, and the choice is saved", async ({ page }) => {
  const saved: unknown[] = [];
  await page.route("**/api/datasets/sim_1_modified/site", (r) =>
    r.request().method() === "PUT" ? (saved.push(r.request().postDataJSON().heat_parts), r.fulfill({ json: r.request().postDataJSON() })) : r.fallback(),
  );
  await settings(page, "Heat distribution");
  const physics = page.getByRole("switch", { name: "Use physical formulas" });
  await physics.click();
  await expect(physics).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("slider", { name: /Heat pump COP/ })).toBeVisible();
  const unit = (name: string) => card(page, "Heat distribution").getByRole("button", { name, exact: true });
  await unit("Heat pump").click();
  await expect(unit("Heat pump")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Heat exchanger only: the source must be hotter/)).toBeVisible();
  await expect(page.getByRole("slider", { name: /Heat pump COP/ })).toBeHidden();
  await unit("Heat exchanger").click();
  await expect(page.getByText(/nothing is delivered/)).toBeVisible();
  await expect.poll(() => saved.at(-1)).toEqual({ hex: false, hp: false, tank: true });
});

test("the data center's Model: the HEX heat Q is calculated from the model's predicted T_in, T_out and m", async ({ page }) => {
  // Q is no model target: the series is offered because the model predicts its parts (simulate computes Q)
  await expect(card(page, "Data center").locator(".heat-plants")).toContainText("Heat: HEX_Cond_Q · model", { timeout: 60_000 });
  await expect(card(page, "Data center").locator(".heat-plants")).toContainText("Supply temperature: HEX_Cond_T_in · model");
});

test("what if on Heat Matching: the year's window, the weather and each part's lever move every part and its KPIs", async ({ context, page }) => {
  test.setTimeout(180_000);
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_box_air"));
  await page.goto("/#/twin/matching");
  const delivered = page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" });
  await expect(delivered).toContainText(/\d+\s*GWh/, { timeout: 120_000 });
  const read = async () => (await delivered.innerText()).replace(/\s+/g, " ");
  const base = await read();
  const open = page.locator(".heat-cards details[open] > summary"); // its More options panels lie over what follows
  while ((await open.count()) > 0) await open.first().click();
  await page.getByText("What if…", { exact: true }).click(); // the levers show on a click
  await expect(page.getByLabel("IT load, as a share of the data's")).toBeVisible();
  await page.getByLabel("Outdoor temperature shift, °C").fill("8"); // warmer: the demand falls, the tower water warms the heat pump's source
  await run(page); // the levers wait for it
  await expect.poll(read).not.toBe(base);
  const warm = await read();
  await page.getByLabel("IT load, as a share of the data's").fill("1.3"); // more IT: more waste heat, once the model has run the year on it
  await expect(read()).resolves.toBe(warm);
  await run(page);
  await expect.poll(read, { timeout: 60_000 }).not.toBe(warm);
  await expect(page.locator(".heat-kpis .kpi", { hasText: "CO₂ saved" })).toContainText(/\d+\s*t/);
  // the district's demand lever (the heat pump's COP is set in its More options)
  const coverage = page.locator(".heat-kpis .kpi", { hasText: "Coverage" });
  const cov = await coverage.innerText();
  await page.getByLabel("Heat demand, as a share of its profile's or data's").fill("1.5"); // more demand: less of it covered
  await run(page);
  await expect.poll(() => coverage.innerText()).not.toBe(cov);
  // the year to pick the window from: its outdoor temperature and its heat, the window's means above them
  const picker = page.getByRole("region", { name: "The year: pick the window" });
  await expect(picker.locator(".heat-meta").first()).toContainText(/outdoor -?[\d,]+ °C/);
  const year = page.getByRole("slider", { name: "week of the year" });
  await year.focus();
  await year.press("Home");
  for (let i = 0; i < 30; i++) await year.press("ArrowRight"); // summer: the diagram's window moves
  await expect(picker.locator(".heat-meta").first()).toContainText(/^week 31 ·/);
  // a click on the temperature chart picks the window under it: near its start, the first weeks
  const chart = picker.locator(".u-over").first();
  const box = (await chart.boundingBox())!;
  await chart.click({ position: { x: 4, y: box.height / 2 } });
  await expect(year).toHaveAttribute("aria-valuenow", "1");
});

test("the weather band opens the weather window: a generated weather is what every part runs on", async ({ page }) => {
  const band = diagram(page).getByRole("button", { name: /^Weather, shared by all three parts/ });
  await band.click();
  const win = page.getByRole("dialog", { name: "Weather" });
  await win.getByRole("radio", { name: "Generated" }).click();
  await win.getByLabel("Mean, °C").fill("2");
  await win.getByRole("button", { name: "Use it" }).click();
  await expect(win).toContainText("Now: generated: 2,0 °C");
  await win.getByRole("button", { name: "Close" }).click();
  await expect(diagram(page).locator(".hf-head").first()).toHaveText("WEATHER · generated");
});
