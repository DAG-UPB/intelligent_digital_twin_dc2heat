/**
 * Site map › Heat distribution on the example sim_recovery_air: the card plans the heat network on its stored streets as
 * it opens; see the
 * pipes on the map (the transmission line straight across the grounds to the station), the metres, the NPV and the break-even in the short
 * card, open the costs and change a price, size the heat pump for the full peak (fewer buildings), drag the station;
 * the hour shown (the map's dials, and in Details the presets, the sliders, play) moving the numbers and the water on
 * the map, the year's figures and the heat sinks not supplied (Details), left off the map; without stored streets the OpenStreetMap button shows the box it would send (never
 * clicked: an external server). Read-only (readonly.ts): nothing is saved, the assumptions and the station live in
 * the browser.
 * Run against a running app: `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/network.spec.ts --project=app`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("dataset", "sim_recovery_air");
    localStorage.setItem("site-card-network", "1"); // the Heat distribution card open (SitePage Group)
    if (!sessionStorage.getItem("net-spec")) {
      // the defaults on the first load of a test (a reload keeps what the test changed)
      sessionStorage.setItem("net-spec", "1");
      localStorage.removeItem("site-network");
      localStorage.removeItem("site-network-station:sim_recovery_air");
    }
  });
  await readOnly(context);
  await context.route("**/api/district/examples", (r) => r.fulfill({ json: [] })); // the machine-local examples: none
});

test.afterEach(async ({ page, context }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.unrouteAll({ behavior: "ignoreErrors" });
});

const card = (page: Page) => page.locator(".site__group--network");
/** A KPI's number in the card ("11,5" M€ → 11.5). */
const kpi = async (page: Page, label: string) =>
  Number((await card(page).locator(".kpi", { hasText: label }).locator(".kpi__value").innerText()).replace(/[^\d,-]/g, "").replace(",", "."));

test("heat distribution: plan the network, its pipes on the map, the costs and a price that moves the NPV", async ({ page }) => {
  await page.goto("/#/twin/map");
  // the card open (beforeEach): it plans by itself on the stored streets
  const net = card(page).getByLabel("The heat network");
  await expect(net.getByText("Buildings supplied")).toBeVisible({ timeout: 30_000 });
  await expect(net).toContainText(/of 150/);
  expect(await kpi(page, "Pipes")).toBeGreaterThan(1); // km
  await expect(net).toContainText("NPV, 20 years");
  await expect(net.locator(".kpi", { hasText: "Break-even" })).toContainText(/year \d+/);
  await expect(net.locator(".kpi", { hasText: "NPV" })).toContainText(/M€ invested/);

  // drawn on the map: the transmission line (straight: one segment), the pipes under the streets, the house connections, the station
  await expect(page.locator("path.net__pipe--transmission")).toHaveCount(1);
  expect((await page.locator("path.net__pipe--transmission").getAttribute("d"))!.match(/L/g)!.length).toBeLessThan(8); // straight across the grounds, then a short way
  expect(await page.locator("path.net__pipe--distribution").count()).toBeGreaterThan(20);
  expect(await page.locator("path.net__pipe--service").count()).toBeGreaterThan(20);
  await expect(page.locator(".net__station")).toBeVisible();
  await card(page).getByRole("checkbox", { name: "On the map" }).uncheck();
  await expect(page.locator("path.net__pipe")).toHaveCount(0);
  await card(page).getByRole("checkbox", { name: "On the map" }).check();
  await expect(page.locator("path.net__pipe--transmission")).toHaveCount(1);

  // the costs: the breakdown, the chart, and a higher heat price gives a higher NPV
  const before = await kpi(page, "NPV");
  await card(page).getByRole("button", { name: "Costs and assumptions…" }).click();
  const dialog = page.getByRole("dialog", { name: "Heat distribution: costs and assumptions" });
  const invest = dialog.getByRole("table", { name: "Investment" });
  for (const item of ["Heat-pump station", "Transmission line", "Distribution pipes", "House connections", "House substations", "Planning", "BEW grant"])
    await expect(invest).toContainText(item);
  await expect(invest).toContainText("funding gap"); // BEW Modul 2 pays at most what the network lacks
  await expect(dialog.getByRole("img", { name: /break-even in year \d+/ })).toBeVisible();
  await dialog.getByRole("spinbutton", { name: /Heat price to the buildings/ }).fill("160");
  await expect.poll(() => kpi(page, "NPV")).toBeGreaterThan(before + 1); // +30 €/MWh on ~25 GWh a year: several M€
  await dialog.getByRole("switch", { name: "BEW grant" }).click();
  await expect(invest).toContainText("none: switched off");
  // the heat pump for the full design peak (the old rule): only the buildings it covers at that peak, ~70 of 150
  const supplied = async () => Number((await net.locator(".kpi", { hasText: "Buildings supplied" }).locator(".kpi__value").innerText()).replace(/\D/g, ""));
  const many = await supplied();
  await dialog.getByRole("switch", { name: /Heat pump for the full peak/ }).click();
  await expect.poll(supplied).toBeLessThan(many - 10);
  await dialog.getByRole("button", { name: "Back to the defaults" }).click();
  await expect.poll(() => kpi(page, "NPV")).toBeCloseTo(before, 1);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  // the station dragged along the street: the plan follows and the place is kept in this browser
  const station = page.locator(".net__station");
  const box = (await station.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("site-network-station:sim_recovery_air"))).not.toBeNull();
  await expect(card(page).getByLabel("The heat network").getByText("Buildings supplied")).toBeVisible();
  await card(page).getByRole("button", { name: "Plan again" }).click(); // the station back where the plan puts it
  await expect.poll(() => page.evaluate(() => localStorage.getItem("site-network-station:sim_recovery_air"))).toBeNull();
});

test("heat distribution: the hour on the map and in the figures, the heat sinks not supplied off the map", async ({ page }) => {
  await page.goto("/#/twin/map");
  const sinkPaths = () => page.locator(".leaflet-overlay-pane path").count(); // the site's outlines and bubbles
  await expect.poll(sinkPaths).toBeGreaterThan(150); // the site drawn: an outline and a bubble per heat sink
  const all = await sinkPaths();
  // the card open (beforeEach): it plans by itself on the stored streets
  await expect(card(page).getByLabel("The heat network").getByText("Buildings supplied")).toBeVisible({ timeout: 30_000 });

  // the card is short: the hour and the figures are on the map's dials and under Details
  await expect(card(page).getByLabel("The hour shown")).toHaveCount(0);
  const dial = page.locator(".maptime").getByRole("slider", { name: "Hour of the day" });
  const shown = page.locator(".maptime .maptime__show").first();
  await expect(shown).toHaveText("18:00"); // a winter evening at first
  await dial.focus();
  await page.keyboard.press("ArrowRight");
  await expect(shown).toHaveText("19:00");
  await page.locator(".maptime").getByRole("button", { name: "Winter evening" }).click();
  await expect(shown).toHaveText("18:00");

  // the heat sinks it cannot supply: counted with their reasons (Details), and off the map while the network is shown
  await expect(card(page)).toContainText(/\d+ heat sinks not supplied, not drawn on the map/);
  await card(page).getByRole("button", { name: "Details…" }).click();
  const details = page.getByRole("dialog", { name: "Heat distribution: the plan in detail" });
  const left = details.getByLabel("Not supplied");
  await expect(left).toContainText(/\d+ heat sinks not supplied/);
  const n = Number((await left.innerText()).match(/(\d+) heat sinks/)![1]);
  expect(n).toBeGreaterThan(0);
  await expect(left).toContainText(/more than 500 m along the streets from the station/);
  await details.getByRole("button", { name: "Close" }).click();
  await expect.poll(sinkPaths).toBeLessThan(all - n);
  await card(page).getByRole("checkbox", { name: "On the map" }).uncheck();
  await expect.poll(sinkPaths).toBe(all);
  await card(page).getByRole("checkbox", { name: "On the map" }).check();
  await expect.poll(sinkPaths).toBeLessThan(all - n);

  // the figures of the year (Details)
  await card(page).getByRole("button", { name: "Details…" }).click();
  await expect(details.getByRole("img", { name: /^The year: / })).toBeVisible();
  await expect(details.getByRole("img", { name: /^Month by month/ })).toBeVisible();
  await expect(details.getByRole("img", { name: /^Winter: / })).toBeVisible();
  await expect(details.getByRole("img", { name: /^Summer: / })).toBeVisible();
  // the data center's heat is the heat used: no exchanger takes 10 % off it again (its texts said so until 2026-11-24)
  await expect(details).not.toContainText("passes 90 %");
  await expect(details.getByRole("img", { name: /^The year: / })).not.toContainText("lost in the exchanger");

  // the hour: a winter evening first (the boiler on, the water fast), then a summer noon (the boiler off, slow water)
  const hour = details.getByLabel("The hour shown");
  const head = hour.locator(".net__hour-head b");
  const figure = async (name: string) => (await hour.locator(".net__hour-grid > div", { hasText: name }).locator("dd").first().innerText()).trim();
  await expect(head).toHaveText(/Jan, 18:00/);
  expect(await figure("Peak boiler")).not.toBe("off");
  const winterDemand = await figure("Demand");
  const fastest = () => page.evaluate(() => Math.max(...[...document.querySelectorAll<SVGElement>("path.net__flow")].map((p) => Number(p.dataset.v))));
  expect(await fastest()).toBeGreaterThanOrEqual(4);
  await hour.getByRole("button", { name: "Summer noon" }).click();
  await expect(head).toHaveText(/Jul, 12:00/);
  await expect.poll(() => figure("Peak boiler")).toBe("off");
  expect(await figure("Demand")).not.toBe(winterDemand);
  await expect.poll(fastest).toBeLessThanOrEqual(2);
  // the hour slider moves it, and so does the day's
  const slider = hour.getByRole("slider", { name: /Hour of the day/ });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(head).toHaveText(/Jul, 00:00/);
  await hour.getByRole("slider", { name: /Day of the year/ }).focus();
  await page.keyboard.press("Home");
  await expect(head).toHaveText("1 Jan, 00:00");
  // play through the day, then pause
  await hour.getByRole("button", { name: "▶ Play the day" }).click();
  await expect(head).not.toHaveText("1 Jan, 00:00", { timeout: 3_000 });
  await hour.getByRole("button", { name: "❚❚ Pause" }).click();
  // a month clicked shows it
  await details.getByRole("button", { name: /^Mar: demand/ }).click();
  await expect(head).toHaveText(/^15 Mar/);

  // the costs' dialog has the figures too
  await details.getByRole("button", { name: "Costs and assumptions…" }).click();
  const dialog = page.getByRole("dialog", { name: "Heat distribution: costs and assumptions" });
  await expect(dialog.getByRole("img", { name: /^The year: / })).toBeVisible();
  await expect(dialog.getByRole("img", { name: /^Month by month/ })).toBeVisible();
});

test("heat distribution: without stored streets, the OpenStreetMap button and the box it would send", async ({ page }) => {
  await page.route("**/api/datasets/*/site/streets", (r) => r.fulfill({ status: 404, json: { detail: "No streets stored with this dataset" } }));
  await page.goto("/#/twin/map");
  // the card open (beforeEach): it plans by itself on the stored streets
  await expect(card(page).getByRole("button", { name: "Load streets from OpenStreetMap" })).toBeVisible({ timeout: 30_000 });
  await expect(card(page)).toContainText(/overpass-api\.de: 50,1\d+, 8,6\d+, 50,1\d+, 8,7\d+/);
});

test("heat distribution: a district drawn as one area is supplied building by building, its share of the demand each", async ({ page }) => {
  // the example's site with one drawn district north of the data center instead of its buildings, and three Wärmeatlas
  // buildings inside it (mocked: the import is machine-local)
  const ring: [number, number][] = [
    [50.1098, 8.6985],
    [50.1098, 8.706],
    [50.1125, 8.706],
    [50.1125, 8.6985],
  ];
  const at = (id: number, lat: number, lon: number, kwh: number) => ({
    id,
    lat,
    lon,
    use: "Wohngebäude",
    type: "MFH",
    age: "2012 or later",
    age_share: 1,
    area_m2: 2000,
    heating_kwh: kwh * 0.8,
    hot_water_kwh: kwh * 0.2,
    total_kwh: kwh,
    heating_2030_kwh: null,
    heating_2045_kwh: null,
    outline: [
      [lat - 0.0001, lon - 0.0002],
      [lat + 0.0001, lon - 0.0002],
      [lat + 0.0001, lon + 0.0002],
      [lat - 0.0001, lon + 0.0002],
    ],
  });
  const houses = [at(1, 50.1105, 8.7, 400_000), at(2, 50.1112, 8.703, 800_000), at(3, 50.1118, 8.705, 1_200_000)];
  await page.route("**/api/district/buildings*", (r) => r.fulfill({ json: { buildings: houses, truncated: false } }));
  await page.route("**/api/datasets/*/site", async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const site = await (await r.fetch()).json();
    const district = { id: "quarter", name: "Quarter", lat: 50.111, lon: 8.702, temp_c: 70, power_kw: 500, outline: ring, area: true, demand: { houses: 3, kwhPerHouse: 800_000 } };
    return r.fulfill({ json: { ...site, sinks: [district] } });
  });
  await page.goto("/#/twin/map");
  const net = card(page).getByLabel("The heat network");
  await expect(net.getByText("Buildings supplied")).toBeVisible({ timeout: 30_000 });
  await expect(net.locator(".kpi", { hasText: "Buildings supplied" })).toContainText(/3\s*of 3/); // its three, not one area
  await expect(page.locator("path.net__pipe--service")).toHaveCount(3); // a house connection to each
  // the district's 2,400 MWh a year, split 1 : 2 : 3 by their Wärmeatlas demand, all of it sold
  await expect(net).toContainText(/2\.\d{3} MWh\/yr sold/);
});
