/**
 * District pages (Site map, Structure and Modelling's profiles): the main interactions, read-only (readonly.ts), and nothing is saved; the OSM lookups (search, building clicks) are not exercised (external servers).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/district.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

/**
 * The number of heat sinks the Site panel shows once the site has loaded (the edit buttons are disabled until then:
 * before, the count is 0 and a drawn area would be lost): specs count relative to it, the user's site may have sinks.
 */
async function sinkCount(page: Page) {
  await expect(page.getByRole("button", { name: "+ Area (district)" })).toBeEnabled({ timeout: 30_000 });
  return Number((await page.getByText(/heat demand · \d+ heat sinks?$/).innerText()).match(/· (\d+)/)![1]);
}
const sinks = (page: Page, n: number) => page.getByText(new RegExp(`heat demand · ${n} heat sinks?$`)); // the District card's first line (SitePage)

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await context.addInitScript(() => ["source", "sink", "quick"].forEach((k) => localStorage.setItem(`site-card-${k}`, "1"))); // the panel's cards open (SitePage Group)
  await readOnly(context);
  // the specs see the simulation's site without the heat sinks a user may have added in the app (the real file is
  // never written); a test that mocks the site itself registers its own route later, which wins
  await context.route("**/api/datasets/*/site", async (r) =>
    r.request().method() === "GET" ? r.fulfill({ json: { ...(await (await r.fetch()).json()), sinks: [] } }) : r.fallback(),
  );
  await context.route("**/api/district/examples", (r) => r.fulfill({ json: [] })); // the machine-local examples: none
  // no Wärmeatlas buildings, whatever this machine imported: a drawn district keeps its default demand; a test that
  // mocks them registers its own route on the page, which wins
  await context.route("**/api/district/buildings?**", (r) => r.fulfill({ json: { truncated: false, buildings: [] } }));
});

// the page keeps loading while a test ends (the Quick analysis reads the site and the data center's data): a mocked
// request answered after the end is not an error
test.afterEach(async ({ page, context }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.unrouteAll({ behavior: "ignoreErrors" });
});

const themeButton = (page: Page) => page.getByRole("button", { name: /Switch to (dark|light) mode/ });

test("site map: draw an area, edit and delete it, toggle modes and the dark map", async ({ page }) => {
  await page.goto("/#/district/map");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const base = await sinkCount(page);

  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [200, 200],
    [400, 200],
    [300, 400],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy); // right of the panel, which floats over the map
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  await expect(sinks(page, base + 1)).toBeVisible();
  await page.getByRole("button", { name: /^Show list/ }).click(); // the heat sinks' list: closed until wanted
  await expect(page.getByRole("textbox", { name: "Name" }).last()).toHaveValue("District 1");
  await expect(page.getByRole("button", { name: "Save site" })).toBeEnabled(); // dirty, never saved here
  // a sink's row says what it counts as (its demand's year, peak and supply): no kW and °C fields that change nothing
  await expect(page.getByLabel("Demand of District 1")).toContainText(/MWh\/a · peak .* kW · \d+ °C/);
  await expect(page.locator(".site__sinks").getByRole("spinbutton")).toHaveCount(0);
  await page.getByRole("button", { name: "Delete District 1" }).click();
  await expect(sinks(page, base + 0)).toBeVisible();

  // fewer than 3 corners cannot finish; Cancel leaves area mode
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  await page.mouse.click(box.x + 650, box.y + 250); // right of the panel
  await expect(page.getByRole("button", { name: "Finish area (1 corners)" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "+ Area (district)" })).toBeVisible();

  await page.getByRole("button", { name: "Pick another building" }).click();
  await expect(page.getByText("Click on the data center's building on the map.")).toBeVisible();
  await page.getByRole("button", { name: "Click a building…" }).click();

  // the street map follows the theme
  const dark = page.locator('.leaflet-layer:has(img[src*="World_Dark_Gray_Base"])');
  const wasDark = (await dark.count()) > 0;
  await themeButton(page).click();
  await expect(dark).toHaveCount(wasDark ? 0 : 1);
  await themeButton(page).click();
  await expect(dark).toHaveCount(wasDark ? 1 : 0);
});

test("site map: unsaved edits stay in this browser across pages; the bin asks to save, then discards", async ({ page }) => {
  await page.goto("/#/district/map");
  const base = await sinkCount(page);
  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [200, 200],
    [400, 200],
    [300, 400],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy); // right of the panel, which floats over the map
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  await expect(sinks(page, base + 1)).toBeVisible();
  // leaving asks first (a project file is recommended); kept in this browser, the edits are there on coming back
  await page.evaluate(() => (window.location.hash = "#/twin/matching")); // as a link does
  const leave = page.getByRole("dialog", { name: "Unsaved edits on the map" });
  await expect(leave.getByRole("button", { name: "Save a project file" })).toBeVisible();
  await leave.getByRole("button", { name: "Keep in this browser" }).click();
  await expect(page).toHaveURL(/#\/twin\/matching/);
  await page.evaluate(() => (window.location.hash = "#/district/map"));
  await expect(sinks(page, base + 1)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Save site" })).toBeEnabled();
  await page.getByRole("button", { name: "Discard the unsaved edits" }).click();
  const ask = page.getByRole("dialog", { name: "Discard the unsaved edits" });
  await expect(ask.getByRole("button", { name: "Save them" })).toBeVisible(); // asked first
  await ask.getByRole("button", { name: "Discard them" }).click();
  await expect(sinks(page, base)).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled(); // not the quick analysis's "CO₂ saved"
  // nothing unsaved: the bin resets what this browser keeps, asked first
  await page.getByRole("button", { name: "Reset what this browser keeps" }).click();
  await expect(page.getByRole("dialog", { name: "Reset what this browser keeps" }).getByRole("button", { name: "Reset" })).toBeVisible();
  await page.getByRole("dialog", { name: "Reset what this browser keeps" }).getByRole("button", { name: "Cancel" }).click();
});

test("site map: the quick analysis follows the data center and the sinks; collapse, close and reopen it", async ({ page }) => {
  await page.goto("/#/twin/map");
  await sinkCount(page);
  const quick = page.getByRole("region", { name: "Quick analysis" });
  await expect(quick).toContainText("Add heat sinks");

  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [150, 150],
    [350, 150],
    [250, 330],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy); // right of the panel, which floats over the map
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  for (const k of ["Heat delivered", "CO₂ saved", "Electricity needed", "Demand of the sinks"])
    await expect(quick.locator(".kpi", { hasText: k })).toContainText("/yr");

  // the map's data center, the first shown: its waste heat kW drives the result
  await expect(quick.getByRole("radio", { name: "On the map" })).toHaveAttribute("aria-checked", "true");
  await expect(quick.getByLabel("Data center used")).toContainText("kW waste heat at");
  const recovered = quick.locator(".kpi", { hasText: "Heat delivered" }).locator(".kpi__value");
  const before = await recovered.innerText();
  await page.getByRole("spinbutton", { name: "Power kW" }).first().fill("5");
  await expect(recovered).not.toHaveText(before);

  // a step of the steps bar shows its card alone under the steps; a second click hides it, a third shows it again
  const step = page.getByRole("button", { name: /: Quick analysis \(/ });
  await step.click();
  await expect(page.getByRole("spinbutton", { name: "Power kW" })).toHaveCount(0); // the data center's card gone
  await expect(step).toHaveAttribute("aria-expanded", "true");
  await step.click();
  await expect(quick).toHaveCount(0);
  await step.click();
  await expect(quick.getByText("Heat delivered")).toBeVisible();
});

test("site map: the quick analysis's forest as soccer fields in the Stadtwald, placed by a click, and back", async ({ page }) => {
  await page.goto("/#/twin/map");
  await sinkCount(page);
  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [150, 150],
    [350, 150],
    [250, 330],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy);
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  const quick = page.getByRole("region", { name: "Quick analysis" });
  const fields = page.locator(".grove__fields--co2");

  // the CO₂'s forest on the map, its label under it; hidden again
  await quick.getByRole("button", { name: "Show in the forest" }).click();
  await expect(fields).toHaveCount(1);
  await expect(page.locator(".grove__forest-label--co2")).toContainText("soccer fields");
  await quick.getByRole("button", { name: "Hide the forest" }).click();
  await expect(page.locator(".grove__fields, .grove__forest-label")).toHaveCount(0);

  // Place the area: the next click on the map draws it there, the map stays put
  await quick.getByRole("button", { name: "Place the area" }).click();
  await expect(page.locator(".site__map.grove-placing")).toHaveCount(1);
  await page.mouse.click(box.x + 650, box.y + 250); // on the area drawn above: its click is the forest's place too
  await expect(fields).toHaveCount(1);
  await expect(page.locator(".grove-placing")).toHaveCount(0);
});

test("site map: left for another page and back, the map is where it was, not centred anew", async ({ page }) => {
  await page.goto("/#/twin/map");
  await sinkCount(page);
  const label = page.locator(".site__dc-label").first(); // an example data center's label: where the map is
  await expect(label).toBeVisible();
  const box = (await page.locator(".site__map").boundingBox())!;
  const before = (await label.boundingBox())!;
  await page.mouse.move(box.x + 700, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 820, box.y + 380, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await label.boundingBox())!.x).toBeGreaterThan(before.x + 100);
  const moved = (await label.boundingBox())!;
  await page.evaluate(() => (window.location.hash = "#/twin/matching"));
  await expect(page.locator(".site__map")).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = "#/twin/map"));
  await sinkCount(page);
  // within a pixel or two: the centre is kept as coordinates, the pixels round
  await expect.poll(async () => Math.abs(((await label.boundingBox())?.x ?? 0) - moved.x)).toBeLessThan(3);
  expect(Math.abs((await label.boundingBox())!.y - moved.y)).toBeLessThan(3);
  // also from a page on another dataset (here the Data center on sim_1) and back
  await page.evaluate(() => {
    localStorage.setItem("dataset:dc/dashboard", "sim_1");
    window.location.hash = "#/dc/dashboard";
  });
  await expect(page.locator(".site__map")).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = "#/twin/map"));
  await sinkCount(page);
  await expect.poll(async () => Math.abs(((await label.boundingBox())?.x ?? 0) - moved.x)).toBeLessThan(3);
  expect(Math.abs((await label.boundingBox())!.y - moved.y)).toBeLessThan(3);
});

test("site map: a waste heat source of the Plattform für Abwärme as a second source in the quick analysis (API mocked)", async ({ page }) => {
  // one hot source in the middle of whatever view is asked for: it is there to click
  await page.route("**/api/district/heat-sources?**", (r) => {
    const [s, w, n, e] = new URL(r.request().url()).searchParams.get("bbox")!.split(",").map(Number);
    const src = {
      id: 7, company: "ACME <GmbH>", site: "Werk", street: "Hanauer Landstraße 1", plz: "60314", city: "Frankfurt am Main",
      name: "Kühlturm", mwh: 40000, max_kw: 6000, temp_c: 95, temp_range: "90 - 110 °C", hours_per_day: 24, weekend: true,
      availability: "7 Tage 24 Std", predictable: true, control: null, note: null, months_mwh: null,
      lat: (s + n) / 2, lon: w + (e - w) * 0.7, geo: "address",
    }; // prettier-ignore
    return r.fulfill({ json: { truncated: false, sources: [src] } });
  });
  await page.goto("/#/twin/map");
  await sinkCount(page);
  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [150, 150],
    [350, 150],
    [250, 330],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy);
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  const quick = page.getByRole("region", { name: "Quick analysis" });
  const covered = quick.locator(".kpi", { hasText: "Heat delivered" }).locator(".kpi__value");
  await expect(covered).toContainText(/\d/);
  const mwh = async () => Number((await covered.innerText()).replace(/[^\d,]/g, "").replace(",", ".")); // "1.234 MWh/yr" → 1234
  const before = await mwh();

  await page.getByRole("button", { name: "Waste heat sources in view" }).click();
  await expect(page.getByText("1 waste heat sources, 40,0 GWh/a. Click one to take it as a second source.")).toBeVisible();
  await expect(page.getByLabel("Waste heat sources legend")).toContainText("≥ 90 °C");
  const circle = page.locator(".leaflet-sources-pane path.site__pfa");
  await expect(circle).toHaveCount(1);
  await circle.hover({ force: true });
  await expect(page.locator(".leaflet-tooltip", { hasText: "Kühlturm" })).toContainText("ACME <GmbH>"); // escaped: shown as text
  await circle.click({ force: true });
  await expect(page.getByLabel("Second source", { exact: true }).first()).toBeVisible();
  const line = quick.getByLabel("Second source");
  await expect(line).toContainText("With Kühlturm");
  await expect(line).toContainText("(directly)"); // 95 °C into a 70 °C network
  await expect(async () => expect(await mwh()).toBeGreaterThan(before)).toPass();

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(line).toHaveCount(0);
  await page.getByRole("button", { name: "Hide sources" }).click();
  await expect(circle).toHaveCount(0);
});

test("site map: a drawn district loads its Wärmeatlas buildings as points, sums their demand and uses it (API mocked)", async ({ page }) => {
  // two buildings in the middle of the district's box (inside the drawn triangle), one far outside it
  await page.route("**/api/district/buildings?**", (r) => {
    const [s, w, n, e] = new URL(r.request().url()).searchParams.get("bbox")!.split(",").map(Number);
    const b = (id: number, lat: number, lon: number, type: string, kwh: number) => ({
      id, lat, lon, use: "Wohngebäude", type, age: null, age_share: null, area_m2: 1000,
      heating_kwh: kwh * 0.8, hot_water_kwh: kwh * 0.2, total_kwh: kwh, heating_2030_kwh: null, heating_2045_kwh: null, outline: null,
    }); // prettier-ignore
    const [lat, lon] = [(s + n) / 2, (w + e) / 2];
    return r.fulfill({ json: { truncated: false, buildings: [b(1, lat, lon, "MFH", 300_000), b(2, lat + (n - s) * 0.05, lon, "EFH", 20_000), b(3, n + 1, e + 1, "MFH", 1e7)] } });
  });
  await page.goto("/#/twin/map");
  const base = await sinkCount(page);
  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [200, 200],
    [400, 200],
    [300, 400],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy);
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  await expect(sinks(page, base + 1)).toBeVisible();
  const areas = page.getByLabel("Districts' buildings");
  await expect(areas).toContainText("District 1: 2 buildings, 320 MWh/a");
  await expect(page.locator(".site__area-building")).toHaveCount(2);
  // the district's demand is its buildings' (the card's sum), the multi-family house's profile (homes: the Aalborg model)
  await expect(page.getByText(/GWh\/a heat demand · \d+ heat sinks?$/)).toContainText("0,3 GWh/a");
  await page.getByRole("button", { name: /^Show list/ }).click();
  await expect(page.getByRole("combobox", { name: "Profile of District 1" })).toHaveValue("aalborg-residential");
});

test("names from the site show as text and never run as HTML", async ({ page }) => {
  const evil = `<img src=x onerror="window.__xss=1">DC`;
  await page.route("**/api/datasets/sim_1_modified/site", async (r) => {
    const res = await r.fetch();
    const site = await res.json();
    await r.fulfill({ response: res, json: { ...site, source: { ...site.source, name: evil } } });
  });
  await page.goto("/#/district/map");
  const source = page.locator(".leaflet-overlay-pane path.leaflet-interactive").last(); // the source bubble, drawn last
  await expect(async () => expect((await source.boundingBox())?.width).toBeGreaterThan(10)).toPass(); // map moved to the site
  // hovered until its tooltip shows: the map may still be moving to the site
  await expect(async () => {
    await source.hover({ force: true });
    await expect(page.locator(".leaflet-tooltip:not(.site__dc-label)")).toContainText(evil, { timeout: 1000 });
  }).toPass();
  await expect(page.locator(".leaflet-tooltip img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
});

test("site map: built-in example data centers plus the machine-local ones, under the site's bubbles (API mocked)", async ({ page }) => {
  const local = { name: "Plant <b>A</b>", address: "Somewhere 1", lat: 50.1131, lon: 8.672, heatKw: 600, basis: "a test", source: "https://example.org" };
  await page.route("**/api/district/examples", async (r) => {
    await new Promise((done) => setTimeout(done, 1000)); // after the site is drawn: the slow case for the drawing order
    await r.fulfill({ json: [local] });
  });
  await page.goto("/#/district/map");
  const labels = page.locator(".site__dc-label");
  await expect(labels).toHaveCount(3);
  await expect(labels.filter({ hasText: "Plant <b>A</b> · 600 kW" })).toHaveCount(1); // escaped: shown as text
  await expect(labels.filter({ hasText: "MiniDC demonstrator" })).toHaveCount(1);
  const source = page.locator(".leaflet-overlay-pane path.leaflet-interactive").last(); // the site's source bubble stays on top
  await expect(async () => expect((await source.boundingBox())?.width).toBeGreaterThan(10)).toPass();
  await source.hover({ force: true });
  await expect(page.locator(".leaflet-tooltip:not(.site__dc-label)")).toContainText("°C");
});

test("site map: Blank is an empty map, no example data centers until switched on in the layer control", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("dataset", "sim_blank"));
  await page.goto("/#/district/map");
  await expect(page.locator(".site__map")).toBeVisible();
  await expect(page.locator(".site__dc-label")).toHaveCount(0);
  await page.locator(".leaflet-control-layers-toggle").click(); // opened by a click, stays open (useSiteMap.ts)
  await page.getByLabel("Data centers (example)").check();
  await expect(page.locator(".site__dc-label").first()).toBeVisible();
});

test("site map: Wärmeatlas buildings of the view, tooltip, add one and all as heat sinks (API mocked)", async ({ page }) => {
  const ring = (lat: number, lon: number) => [
    [lat, lon],
    [lat + 0.0003, lon],
    [lat + 0.0003, lon + 0.0004],
    [lat, lon + 0.0004],
    [lat, lon],
  ];
  const building = (id: number, lat: number, lon: number, use: string, type: string, heating: number, water: number) => ({
    id, lat: lat + 0.00015, lon: lon + 0.0002, use, type, age: "1958–1968", age_share: 0.6, area_m2: 4000,
    heating_kwh: heating, hot_water_kwh: water, total_kwh: heating + water, heating_2030_kwh: null, heating_2045_kwh: null, outline: ring(lat, lon),
  }); // prettier-ignore
  const asked: string[] = [];
  await page.route("**/api/district/buildings?**", (r) => {
    asked.push(new URL(r.request().url()).searchParams.get("bbox")!);
    return r.fulfill({
      json: {
        truncated: false,
        buildings: [
          building(1, 50.1093, 8.7035, "Bürogebäude <b>x</b>", "Büro-, Verwaltungs- oder Amtsgebäude", 400000, 100000),
          building(2, 50.1085, 8.7015, "Wohngebäude", "MFH", 80000, 20000),
        ],
      },
    });
  });
  // the streets' heat line density, loaded with them: one dense street between the two buildings
  await page.route("**/api/district/heat-lines?**", (r) =>
    r.fulfill({
      json: {
        truncated: false,
        lines: [{ id: 1, name: "Zeil", kind: "Gemeindestraße", length_m: 150, mwh_per_m: 3.2, mwh: 480, line: [[[50.1089, 8.701], [50.1089, 8.704]]] }],
      },
    }),
  );
  await page.goto("/#/district/map");
  const base = await sinkCount(page);
  await page.getByRole("button", { name: "Load heat demand in view" }).click();
  await expect(page.getByText("2 buildings, 600 MWh/a. Click one to add it as a heat sink.")).toBeVisible();
  const [s, w, n, e] = asked[0].split(",").map(Number);
  expect(n - s).toBeLessThan(0.02); // only the view was asked for
  expect(e - w).toBeLessThan(0.03);
  await expect(page.locator(".leaflet-control-attribution")).toContainText("Wärmebedarf © LEA Hessen");
  await expect(page.getByLabel("Heat demand legend")).toContainText("MWh/a"); // the buildings: by heat demand (the sinks' bubbles: by use)

  const shapes = page.locator(".leaflet-heat-pane path.leaflet-interactive:not(.site__heat-line)");
  await expect(shapes).toHaveCount(2);
  // the heat line density: a line under the buildings, its legend, its tooltip; switched off and on
  const heatLines = page.locator(".leaflet-heat-pane path.site__heat-line");
  await expect(heatLines).toHaveCount(1);
  await expect(page.getByLabel("Heat line density legend")).toContainText("MWh/(m·a)");
  await expect(page.locator(".leaflet-control-attribution")).toContainText("Wärmeliniendichte © LEA Hessen");
  await expect(async () => {
    await heatLines.hover({ force: true, position: { x: 15, y: 2 } }); // its west end: the data center's outline covers its middle
    await expect(page.locator(".leaflet-tooltip", { hasText: "Zeil" })).toContainText("3,20 MWh/(m·a) heat line density", { timeout: 1000 });
  }).toPass();
  await page.mouse.move(0, 0);
  await page.getByRole("checkbox", { name: "Heat line density" }).uncheck();
  await expect(heatLines).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Heat line density" }).check();
  await expect(heatLines).toHaveCount(1);
  await shapes.first().hover(); // not forced: the colours are on top of the map's tiles, to be seen and pointed at
  // the building's own tooltip (on the way there the pointer may cross the heat line, whose tooltip can still be open)
  const tip = page.locator(".leaflet-tooltip:not(.site__dc-label):not(:has-text('heat line density'))");
  await expect(tip).toContainText("Bürogebäude <b>x</b>"); // escaped: shown as text
  await expect(tip).toContainText("Heating 400,0 MWh/a · hot water 100,0 MWh/a");

  // the correction applies to the non-residential building only
  await page.getByRole("spinbutton", { name: "Non-residential correction" }).fill("2");
  await shapes.first().click({ force: true });
  await expect(sinks(page, base + 1)).toBeVisible();
  await expect(page.getByText(/Added Bürogebäude <b>x<\/b> 1 \(1\.000,0 MWh\/a\)/)).toBeVisible();

  page.once("dialog", (d) => {
    expect(d.message()).toBe("Add 1 buildings as heat sinks, 100 MWh/a in total?");
    return d.accept();
  });
  await page.getByRole("button", { name: "Add all in view" }).click();
  await expect(sinks(page, base + 2)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save site" })).toBeEnabled(); // never pressed: readOnly would abort it anyway

  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(shapes).toHaveCount(0);
  await expect(heatLines).toHaveCount(0);
  await expect(page.locator(".leaflet-control-attribution")).not.toContainText("LEA");

  // zoomed out beyond 2 × 2 km: nothing can be loaded
  const load = page.getByRole("button", { name: "Load heat demand in view" });
  await expect(async () => {
    await page.getByRole("button", { name: "Zoom out" }).click(); // clicks during the zoom animation are dropped
    await expect(load).toBeDisabled({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText(/^Zoom in: the view is/)).toBeVisible();
});

test("profile generator: a total per unit becomes a curve that holds exactly the total over its period", async ({ page }) => {
  // the district's heat demand is a profile under its Modelling: open it, start from the residential preset
  await page.goto("/#/district/structure");
  const below = page.getByRole("region", { name: "Modelling" });
  await below.scrollIntoViewIfNeeded();
  await below.getByRole("button", { name: /^Measurement or profile/ }).click({ timeout: 30_000 }); // the column's settings: its profiles
  await below.locator("summary", { hasText: /^(Q_houses|Heat_Demand) · profile$/ }).click({ timeout: 30_000 });
  const card = page.locator(".card__title", { hasText: /^(Q_houses|Heat_Demand) · profile$/ }).locator("..");
  await card.getByLabel("Start from").selectOption("residential");
  const over = card.locator(".kpi", { hasText: /^Over the/ });
  await expect(over).toContainText("2.400.000"); // 200 houses × 12,000 kWh per year
  await expect(card.getByRole("spinbutton", { name: "Total per unit" })).toHaveValue("12.000"); // with thousand separators
  await card.getByLabel("Start from").selectOption("bdew-hef03");
  await expect(over).toContainText("18.000"); // one total for everything
  await card.getByRole("spinbutton", { name: "Total", exact: true }).fill("5000");
  await expect(over).toContainText("5.000"); // the profile rebuilt to that total
  await card.getByText(/^Shape it yourself/).click(); // the shaping is behind it, closed in the standard view
  await card.getByRole("radio", { name: "Per unit × units" }).click();
  await card.getByLabel("Units").fill("36");
  await expect(over).toContainText("180.000"); // 36 × 5,000 kWh
  await card.getByRole("radio", { name: "Year" }).click();
  await expect(card.locator(".kpi", { hasText: /^Shown/ })).toContainText("180.000"); // the whole year shown: all of it
  await card.getByRole("radio", { name: "Day" }).click();
  await expect(card.locator(".kpi", { hasText: /^Shown/ })).not.toContainText("180.000"); // a day: its part of the year
  // the shapes are drawn: a weekday bar takes the arrow keys
  const monday = card.getByRole("slider", { name: "Day of week Mo" });
  const before = Number(await monday.getAttribute("aria-valuenow"));
  await monday.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => Number(await monday.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await expect(over).toContainText("180.000"); // reshaped, the total holds
  // the average day is drawn in the unit per hour: moving its line up moves the total with it
  await card
    .getByRole("slider", { name: /, level$/ })
    .first()
    .focus();
  await page.keyboard.press("ArrowUp");
  await expect(over).toContainText("183.600"); // + 2 %
});

test("Modelling: only the district's heat demand starts as a profile; a variable moves between the approaches", async ({ page }) => {
  await page.goto("/#/district/structure");
  const below = page.getByRole("region", { name: "Modelling" });
  await below.scrollIntoViewIfNeeded();
  const way = (name: string) => below.getByRole("region", { name, exact: true });
  // its graph's variables only (none of the data center's own columns): the heat demand a profile, the rest not modelled
  const demandVar = way("Measurement or profile").locator(".train-var");
  await expect(demandVar).toHaveCount(1, { timeout: 30_000 });
  await expect(demandVar).toHaveText(/^(Q_houses|Heat_Demand)/);
  await expect(way("Not modelled").locator('[data-var="n_units"]')).toBeVisible();
  await expect(below.locator('[data-var="HEX_Cond_T_in"]')).toHaveCount(0);
  // the heat demand starts from the homes' profile (the Aalborg model); the site's heat sinks (its buildings, with their annual demand) are there to
  // pick, never applied by themselves; each profile is folded until its variable is clicked (the column's settings opened first)
  await below.getByRole("button", { name: /^Measurement or profile/ }).click();
  await below.locator("summary", { hasText: /^(Q_houses|Heat_Demand) · profile$/ }).click();
  const demand = page.locator(".card__title", { hasText: /^(Q_houses|Heat_Demand) · profile$/ }).locator("..");
  const from = demand.getByLabel("Start from");
  await expect(from).toHaveValue("aalborg-residential");
  await expect(from.locator('optgroup[label="Buildings and areas of the site map"] option').first()).toHaveText(/MWh\/a$/);
  await from.selectOption("heat-demand");
  await expect(demand.locator(".kpi", { hasText: /^Over the/ })).toBeVisible();
  // n_units given a profile: it starts constant
  await below.getByLabel("Approach of n_units").selectOption("profile");
  await below.locator("summary", { hasText: /^n_units · profile$/ }).click();
  const one = page.locator(".card__title", { hasText: /^n_units · profile$/ }).locator(".."); // its own card, not the Profile card around it
  await expect(one.getByLabel("Start from")).toHaveValue("constant");
  await one.getByRole("spinbutton", { name: "Total", exact: true }).fill("200");
  await expect(one.locator(".kpi", { hasText: /^Over the/ })).toContainText("200");
  // moved to physical: out of the profiles, an equation row to write it in
  await below.getByLabel("Approach of n_units").selectOption("physics");
  await expect(way("Physical and semi-physical").locator('[data-var="n_units"]')).toBeVisible();
  await expect(one).toHaveCount(0);
  await expect(below.getByRole("textbox", { name: "Equation for n_units" })).toBeVisible();
  // removing its equation moves it back to where it started: not modelled
  await below.getByRole("button", { name: "Remove the equation for n_units" }).click();
  await expect(way("Not modelled").locator('[data-var="n_units"]')).toBeVisible();
});

test("a heat sink of the site map: its profile in the district's Modelling for a look, and back", async ({ page }) => {
  await page.goto("/#/twin/map");
  const base = await sinkCount(page);
  // a new area, unsaved: its settings go along
  const box = (await page.locator(".site__map").boundingBox())!;
  await page.getByRole("button", { name: "+ Area (district)" }).click();
  for (const [dx, dy] of [
    [200, 200],
    [400, 200],
    [300, 400],
  ])
    await page.mouse.click(box.x + 400 + dx, box.y + dy); // right of the panel, which floats over the map
  await page.getByRole("button", { name: "Finish area (3 corners)" }).click();
  await expect(sinks(page, base + 1)).toBeVisible();
  await page.getByRole("button", { name: /^Show list/ }).click(); // the heat sinks' list: closed until wanted
  const name = "District 1";
  // a profile for all heat sinks, or one of its own; hovering a sink shows its name, a click its profile (the months
  // of a year and an average day in January and July) with the way to its profile in Modelling
  await page.getByLabel("Profile of all heat sinks").selectOption("constant");
  await expect(page.getByLabel(`Profile of ${name}`, { exact: true })).toHaveValue(""); // as all
  await page.locator(".leaflet-overlay-pane path.leaflet-interactive[stroke-dasharray]").first().hover({ force: true });
  const tip = page.locator(".leaflet-tooltip", { hasText: name });
  await expect(tip).toContainText("kW");
  await expect(tip).not.toContainText("MWh/a");
  await page.getByLabel(`Profile of ${name}`, { exact: true }).selectOption("office-hours");
  const area = page.locator(".leaflet-overlay-pane path.leaflet-interactive[stroke-dasharray]").first();
  const popup = page.locator(".leaflet-popup");
  await area.click({ force: true });
  await expect(popup).toHaveCount(0); // a click opens nothing (it stays the map's)
  await area.dblclick({ force: true });
  await expect(popup).toContainText("Office hours");
  await expect(popup.locator('svg[aria-label="MWh per month"] rect')).toHaveCount(12);
  await expect(popup.locator('svg[aria-label="kW over a day"] polyline')).toHaveCount(2);
  await expect(popup.getByRole("button", { name: "Its profile in Modelling →" })).toBeVisible();
  // a drag that would push the card past the map's top: the map pans back, the card stays inside
  const map = (await page.locator(".site__map").boundingBox())!;
  await page.mouse.move(map.x + map.width - 150, map.y + map.height - 120);
  await page.mouse.down();
  await page.mouse.move(map.x + map.width - 150, map.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await popup.boundingBox())!.y, { timeout: 5_000 }).toBeGreaterThanOrEqual(map.y);
  // the list closes and opens again; the panel's edge moves
  await page.getByRole("button", { name: "Hide list" }).click();
  await expect(page.getByLabel(`Profile of ${name}`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Show list/ }).click();
  const edge = page.getByRole("separator", { name: "Side panel width" });
  await edge.focus();
  await page.keyboard.press("ArrowRight");
  await expect(edge).toHaveAttribute("aria-valuenow", "316"); // the default 300, one step wider
  // the unsaved site is saved on the way (mocked: real data is never written), no question asked
  const saved: unknown[] = [];
  await page.route("**/api/datasets/*/site", (r) =>
    r.request().method() === "PUT" ? (saved.push(r.request().postDataJSON()), r.fulfill({ json: r.request().postDataJSON() })) : r.fallback(),
  );
  await page.getByRole("button", { name: `Edit the profile of ${name} in Modelling` }).click();
  await expect(page).toHaveURL(/#\/district\/structure$/);
  expect(saved).toHaveLength(1);
  const card = page.locator(".card__title", { hasText: `${name} · building profile` }).locator("..");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByLabel("Start from")).toHaveValue(/^heat-demand:/);
  await expect(card.getByLabel("in", { exact: true })).toHaveValue("MWh"); // a building of the city: in MWh
  await page.getByRole("link", { name: "← Back to the site map" }).click();
  await expect(page).toHaveURL(/#\/twin\/map$/);
  await sinkCount(page); // the site map is back (and its site loaded)
});
