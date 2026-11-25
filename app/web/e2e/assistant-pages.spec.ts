/**
 * The assistant works every page as the user does (MCP parity): the page details carry what the page shows as numbers
 * (Heat Matching's KPIs and window, the quick analysis, the dashboard's KPIs, the Modelling), folded panels open by
 * click, a name that repeats is picked by its card ("Data center › More options"), and the page's own commands do
 * what no click can (the year picker's band, a part's way). Read-only: nothing is saved.
 * The assistant works the tab in front, so this spec must be the only page of the app open: run it alone, against an
 * app nobody else uses: `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/assistant-pages.spec.ts --workers=1`.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readOnly } from "./readonly";

type Control = { ref: string; name: string; kind: string; value?: unknown; on?: boolean; in?: string };
type Snap = { route: string; controls: Control[]; commands: string[]; detail: Record<string, any> };

const snap = async (request: APIRequestContext): Promise<Snap> => {
  const r = await request.get("/api/live/snapshot?images=false");
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
};
const doIt = async (request: APIRequestContext, action: string, args: object, status = 200) => {
  const r = await request.post("/api/live/command", { data: { action, args } });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
};

test.describe.configure({ mode: "serial" });

// Connect AI, as in assistant.spec.ts: an open page shows the code, the agent pairs with it
let token = "";
test.beforeAll(async ({ browser, playwright }) => {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL });
  await readOnly(context);
  const page = await context.newPage();
  await page.goto("/#/home/start");
  const api = await playwright.request.newContext({ baseURL });
  await page.getByRole("button", { name: "Connect AI" }).click();
  await expect(page.getByLabel("Code")).toHaveText(/^\d{3} \d{3}$/);
  const code = (await page.getByLabel("Code").innerText()).replace(/\D/g, "");
  const r = await api.post("/api/live/pair", { data: { code } });
  expect(r.status(), await r.text()).toBe(200);
  token = (await r.json()).token;
  await api.dispose();
  await context.close();
});
// Disconnect at the end: the next spec pairs from a fresh Connect AI
test.afterAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  await api.delete("/api/live/pair");
  await api.dispose();
});
test.use({ extraHTTPHeaders: async ({}, use) => use({ "X-Agent-Token": token }) });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_recovery_air"));
  await readOnly(context);
});

const onRoute = (request: APIRequestContext, route: string) =>
  expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).state?.route, { timeout: 20_000 }).toBe(route);

test("Heat Matching: KPIs and window in the details, panels by click, the band and the ways by command", async ({ page, request }) => {
  await page.goto("/#/twin/matching");
  await onRoute(request, "twin/matching");
  await expect.poll(async () => (await snap(request)).detail.heat_matching?.kpis?.length ?? 0, { timeout: 60_000 }).toBe(7);
  const first = await snap(request);
  expect(first.commands).toEqual(expect.arrayContaining(["set_window", "set_part_way"]));
  const hm = first.detail.heat_matching;
  expect(hm.kpis[0]).toMatchObject({ label: "Coverage", unit: "%" });
  expect(hm.kpis[1].value).toBeGreaterThan(0); // heat delivered, MWh
  expect(hm.window).toMatchObject({ kind: "week", number: 3 }); // the page opens on the third week

  // three cards have "More options": the snapshot says which card each is in, and that one opens
  const more = first.controls.filter((c) => c.name === "More options");
  expect(more.length).toBe(3);
  expect(more[0].in).toContain("Data center");
  await doIt(request, "click", { control: "Data center › More options" });
  const opened = (await snap(request)).controls.filter((c) => c.name === "More options");
  expect(opened.map((c) => !!c.on)).toEqual([true, false, false]);
  await doIt(request, "fill", { control: "Data center: model and system", value: "model:xgb" }); // its folder in the diagram
  await expect.poll(async () => (await snap(request)).detail.heat_matching.dc_trained_model.running).toBe("xgb");

  // What if…: a folded panel too; its select by a dataset id
  await doIt(request, "click", { control: "What if…" });
  await doIt(request, "fill", { control: "Weather from", value: "sim_district_heat" });
  await doIt(request, "fill", { control: "Outdoor temperature shift, °C", value: 3 });
  await doIt(request, "click", { control: "Run scenario" }); // the levers wait for it
  await expect.poll(async () => (await snap(request)).detail.heat_matching.inputs.weather_from).toBe("sim_district_heat");
  expect((await snap(request)).detail.heat_matching.what_if.outdoor_shift_K).toBe(3);

  // the year picker's band: by number and by date; a drawn slider says to use the command
  await doIt(request, "set_window", { number: 5 });
  expect((await snap(request)).detail.heat_matching.window.number).toBe(5);
  const { from } = (await snap(request)).detail.heat_matching.period;
  const tenth = new Date(Date.parse(from) + 9 * 7 * 86400_000 + 3600_000).toISOString().slice(0, 10);
  await doIt(request, "set_window", { date: tenth });
  expect((await snap(request)).detail.heat_matching.window.number).toBe(10);
  await expect(page.getByRole("slider", { name: /of the year/ })).toHaveAttribute("aria-valuenow", "10");
  await doIt(request, "set_window", {}, 400); // the backend checks the arguments first

  // a part's way, as its Model / Calculation radios
  await doIt(request, "set_part_way", { part: "heat", way: "calculation" });
  await expect.poll(async () => (await snap(request)).detail.heat_matching.parts.heat.runs).toBe("calculation");
  const bad = await doIt(request, "set_part_way", { part: "hp", way: "model" }, 422);
  expect(bad.detail).toContain("dc, heat, district");
});

test("the Site map's quick analysis reports its source and results", async ({ page, request }) => {
  await page.goto("/#/twin/map");
  await onRoute(request, "twin/map");
  await expect.poll(async () => (await snap(request)).detail.quick_analysis?.data_center_from ?? null, { timeout: 30_000 }).not.toBeNull();
  const d = (await snap(request)).detail;
  expect(d.map_centre ?? null).not.toBeUndefined(); // the site map's own details stay beside it
  expect(d.quick_analysis.next).toContain("Heat Matching");
});

test("the dashboard reports its KPIs of the period chosen, and the period follows the select", async ({ page, request }) => {
  await page.goto("/#/dc/dashboard");
  await onRoute(request, "dc/dashboard");
  await expect.poll(async () => (await snap(request)).detail.dashboard?.overview?.rows ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const d = (await snap(request)).detail.dashboard;
  expect(d.mode).toBe("historical");
  expect(d.kpis.length).toBeGreaterThan(0);
  expect(d.kpis[0]).toHaveProperty("unit");
  if (d.years.length > 1) {
    await doIt(request, "fill", { control: "Period", value: String(d.years[1]) });
    await expect.poll(async () => (await snap(request)).detail.dashboard.period).toContain(String(d.years[1]));
  }
  await doIt(request, "click", { control: "Weekly and monthly" });
  await expect.poll(async () => (await snap(request)).detail.dashboard.view).toBe("Weekly and monthly");
});

test("Structure and Modelling: the built-in drawing and the Modelling under it, side by side in the details", async ({ page, request }) => {
  await page.goto("/#/dc/pid");
  await onRoute(request, "dc/pid");
  await expect.poll(async () => (await snap(request)).detail.instruments?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  await doIt(request, "scroll", { to: "Modelling" }); // it loads once scrolled near, as for the user
  await expect.poll(async () => (await snap(request)).detail.modelling?.saved_models?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const d = (await snap(request)).detail;
  expect(d.instruments.length).toBeGreaterThan(0); // the structure's details are still there
  expect(d.built_in_drawing).toContain("air-cooled");
  expect(Object.keys(d.modelling.approaches).length).toBeGreaterThan(0);
  // the Variables menu is a folded panel: it opens by click and its approach chips appear
  const menu = (await snap(request)).controls.find((c) => c.kind === "disclosure" && /shown$/.test(c.name))!;
  await doIt(request, "click", { control: menu.ref });
  expect((await snap(request)).controls.some((c) => c.name.startsWith("Data-driven"))).toBe(true);
});
