/**
 * The assistant (MCP) sees and works the open page as the user would (backend/routers/live.py, app/assistant.ts):
 * the snapshot lists the controls, pictures the P&ID with its grid and gives the page details; ui_do presses and
 * fills controls by name and does the gestures on drawings and maps. Read-only: nothing is saved.
 * The assistant works the tab in front, so this spec must be the only page of the app open: run it alone,
 * against an app nobody else uses: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/assistant.spec.ts --workers=1`.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readOnly } from "./readonly";

type Snap = {
  route: string;
  controls: { name: string; kind: string; value?: unknown }[];
  images: { label: string; grid?: boolean; png: string }[];
  detail: Record<string, any>;
};

const snap = async (request: APIRequestContext, images = false): Promise<Snap> => {
  const r = await request.get(`/api/live/snapshot${images ? "" : "?images=false"}`);
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
};
const doIt = async (request: APIRequestContext, action: string, args: object, status = 200) => {
  const r = await request.post("/api/live/command", { data: { action, args } });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
};

// a reload is a new tab to the server; the old one's stream goes at its next ping (core/live.py HEARTBEAT_S)
const onePage = (request: APIRequestContext) =>
  expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).pages, { timeout: 20_000 }).toBe(1);

test.describe.configure({ mode: "serial" });

// Connect AI, as the user does it: an open page shows a code, the agent pairs with it; the token goes on every call of
// the spec's `request` (the page tools refuse without it)
let token = "";
test.beforeAll(async ({ browser, playwright }) => {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL });
  await readOnly(context);
  const page = await context.newPage();
  await page.goto("/#/home/start");
  const api = await playwright.request.newContext({ baseURL });
  expect((await api.get("/api/live/ui-state")).status()).toBe(403); // not connected yet
  await page.getByRole("button", { name: "Connect AI" }).click();
  await expect(page.getByLabel("Code")).toHaveText(/^\d{3} \d{3}$/); // "…" until the code comes
  const code = (await page.getByLabel("Code").innerText()).replace(/\D/g, "");
  expect(code).toHaveLength(6);
  const r = await api.post("/api/live/pair", { data: { code } });
  expect(r.status(), await r.text()).toBe(200);
  token = (await r.json()).token;
  await expect(page.getByRole("button", { name: "AI connected" })).toBeVisible();
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
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await context.addInitScript(() => ["dc", "heat", "district"].forEach((s) => localStorage.setItem(`${s}-structure-edit`, "1"))); // the Structure pages in edit mode (PidPage)
  await readOnly(context);
});

test("the assistant sees the Structure and Modelling page and works its controls and drawing", async ({ page, request }) => {
  await page.goto("/#/dc/pid");
  await expect(page.getByRole("heading", { name: "Structure and Modelling" })).toBeVisible();
  await expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).state?.route).toBe("dc/pid");

  // the graph loads after the page: wait until its instruments are drawn
  await expect.poll(async () => (await snap(request)).detail.instruments?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(2);
  const first = await snap(request, true);
  const names = first.controls.map((c) => c.name);
  for (const n of ["+ Add link", "+ Variable", "Graph file", "Condenser HEX", "Hall HEX", "Fade P&ID into causal links", "Save as…"])
    expect(names).toContain(n);
  expect(first.images.some((i) => i.grid && i.png.length > 1000)).toBe(true);
  const instruments = first.detail.instruments as { variable: string; x: number; y: number }[];
  expect(instruments.length).toBeGreaterThan(2);
  for (const i of instruments) expect(i.x >= 0 && i.x <= 1 && i.y >= 0 && i.y <= 1).toBe(true);

  // the fade slider, by its name
  await doIt(request, "fill", { control: "Fade P&ID into causal links", value: 0.5 });
  expect((await snap(request)).detail.fade_slider).toBe(0.5);
  await doIt(request, "fill", { control: "Fade P&ID into causal links", value: 0 });

  // drag an instrument: it lands where asked (snapped to the grid), not saved; the drawing opens locked, unlock it first
  await doIt(request, "click", { control: "Locked" });
  const v = instruments[0].variable;
  await doIt(request, "move_instrument", { variable: v, x: 0.5, y: 0.5 });
  const moved = (await snap(request)).detail;
  const at = (moved.instruments as { variable: string; x: number; y: number }[]).find((i) => i.variable === v)!;
  expect(Math.abs(at.x - 0.5)).toBeLessThan(0.03);
  expect(Math.abs(at.y - 0.5)).toBeLessThan(0.05);
  expect(moved.unsaved).toBe(true);

  // add a link as the user would: the button, then source and target
  const [a, b] = [instruments[1].variable, instruments[2].variable];
  await doIt(request, "click", { control: "+ Add link" });
  expect((await snap(request)).detail.link_mode).toBe(true);
  await doIt(request, "click_instrument", { variable: a });
  await doIt(request, "click_instrument", { variable: b });
  const linked = (await snap(request)).detail;
  expect(linked.link_mode).toBe(false);
  expect((linked.links as { from: string; to: string }[]).some((l) => l.from === a && l.to === b)).toBe(true);

  // a new variable only to draw (no data), as "+ Variable" does; delete it again; delivered data cannot be deleted
  await doIt(request, "add_variable", { variable: "speed" });
  const added = (await snap(request)).detail.instruments as { variable: string; data: string }[];
  expect(added.find((i) => i.variable === "speed")?.data).toBe("none");
  expect((await doIt(request, "delete_variable", { variable: a }, 422)).detail).toContain("delivered data");
  await doIt(request, "delete_variable", { variable: "speed" });
  expect(((await snap(request)).detail.instruments as { variable: string }[]).some((i) => i.variable === "speed")).toBe(false);

  // a toggle, and what the assistant gets back for a control that is not there
  await doIt(request, "click", { control: "Hall HEX" });
  expect((await snap(request)).detail.heat_recovery).toBe("hall");
  expect((await doIt(request, "click", { control: "Fly to the moon" }, 422)).detail).toContain("No control named");
});

test("the assistant and the user draw the digital construct and put variables on it", async ({ page, request }) => {
  await page.goto("/#/dc/pid");
  await expect(page.getByRole("heading", { name: "Structure and Modelling" })).toBeVisible();
  // this tab, not the one the test before closed, is the one the assistant works
  await expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).pages, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await snap(request)).detail.instruments?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(2);
  type Shape = { id: string; kind: string; label: string; role: string; x?: number; y?: number };
  const shapes = async () => ((await snap(request)).detail.construct as { shapes: Shape[] }).shapes;
  const before = (await shapes()).length;

  // the assistant: shapes by kind, in fractions of the drawing (as ui_snapshot's grid)
  await doIt(request, "add_shape", { kind: "rect", x: 0.3, y: 0.3, w: 0.1, h: 0.08, label: "Pump 1" });
  await doIt(request, "add_shape", { kind: "circle", x: 0.5, y: 0.2, label: "TI 101", role: "instrument" });
  await doIt(request, "add_shape", {
    kind: "line",
    points: [
      [0.1, 0.5],
      [0.6, 0.5],
    ],
  });
  const made = (await shapes()).slice(before);
  expect(made.map((s) => [s.kind, s.label])).toEqual([
    ["rect", "Pump 1"],
    ["circle", "TI 101"],
    ["line", ""],
  ]);
  expect(Math.abs(made[0].x! - 0.3)).toBeLessThan(0.01);
  expect(Math.abs(made[0].y! - 0.3)).toBeLessThan(0.01);
  expect((await snap(request)).detail.construct.unsaved).toBe(true);

  // a variable on the instrument bubble: its instrument moves there and takes the ISA code as its tag
  const v = ((await snap(request)).detail.instruments as { variable: string }[])[0].variable;
  await doIt(request, "match_variable", { shape: made[1].id, variable: v });
  const on = ((await snap(request)).detail.instruments as { variable: string; x: number; y: number; tag: string }[]).find((i) => i.variable === v)!;
  expect(Math.abs(on.x - made[1].x!)).toBeLessThan(0.02);
  expect(Math.abs(on.y - made[1].y!)).toBeLessThan(0.02);
  expect(on.tag).toBe("TI");

  await doIt(request, "edit_shape", { shape: made[0].id, label: "Pump 2" });
  await doIt(request, "delete_shape", { shape: made[2].id });
  expect((await shapes()).slice(before).map((s) => s.label)).toEqual(["Pump 2", "TI 101"]);
  expect((await doIt(request, "delete_shape", { shape: "nope" }, 422)).detail).toContain("There is no shape nope");

  await doIt(request, "set_layers", { picture: false, variables: false });
  expect((await snap(request)).detail.layers).toEqual({ picture: false, construct: true, variables: false });
  await doIt(request, "set_layers", { picture: true, variables: true });

  // the user: Edit construct, the Rectangle tool, a drag on the drawing; the inspector names it (unlocked first: it opens locked)
  await page.getByRole("button", { name: "Locked" }).click();
  await page.getByRole("button", { name: "Edit construct" }).click();
  await page.getByRole("group", { name: "Drawing tool" }).getByRole("button", { name: "Rectangle" }).click();
  const drawing = page.getByRole("img", { name: "P&ID with causal links" });
  await drawing.evaluate((el) => el.scrollIntoView({ block: "center" })); // the bars above push it below the window
  const box = (await drawing.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 4 });
  await page.mouse.up();
  const drawnByHand = (await shapes()).slice(before);
  expect(drawnByHand).toHaveLength(3);
  await page.getByLabel("Label", { exact: true }).fill("Tank 3");
  expect((await shapes()).at(-1)?.label).toBe("Tank 3");
});

test("the assistant places many instruments in one call; the unsaved work is a draft that survives a reload", async ({ page, request }) => {
  // the test before's tab has gone, so the requests reach this one
  await expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).pages, { timeout: 20_000 }).toBe(0);
  await page.goto("/#/dc/pid");
  await expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).pages, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => (await snap(request)).detail.instruments?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(3);
  type Inst = { variable: string; x: number; y: number };
  const instruments = async () => (await snap(request)).detail.instruments as Inst[];
  const start = await instruments();
  const placements = start.slice(0, 3).map((i, k) => ({ variable: i.variable, x: 0.2 + 0.2 * k, y: 0.5 }));
  await doIt(request, "click", { control: "Locked" }); // it opens locked
  expect((await doIt(request, "place_instruments", { placements: [...placements, { variable: "nope", x: 0, y: 0 }] }, 422)).detail).toContain("nope");
  expect((await doIt(request, "place_instruments", { placements })).did).toContain("placed 3");
  const at = (list: Inst[], v: string) => list.find((i) => i.variable === v)!;
  for (const p of placements) {
    expect(Math.abs(at(await instruments(), p.variable).x - p.x)).toBeLessThan(0.02);
    expect(Math.abs(at(await instruments(), p.variable).y - p.y)).toBeLessThan(0.03);
  }
  // many links in one call: add, change the lags, a self-link, remove; one wrong entry changes nothing
  const [a, b, c] = placements.map((p) => p.variable);
  type L = { from: string; to: string; lags: number[] };
  const links = async () => (await snap(request)).detail.links as L[];
  expect(
    (
      await doIt(
        request,
        "set_links",
        {
          links: [
            { from: a, to: b },
            { from: a, to: "nope" },
          ],
        },
        422,
      )
    ).detail,
  ).toContain("nope");
  expect(
    (
      await doIt(request, "set_links", {
        links: [
          { from: a, to: b },
          { from: b, to: c, lags: [2, 1] },
          { from: c, to: c },
        ],
      })
    ).did,
  ).toContain("set 3 links");
  expect((await links()).find((l) => l.from === a && l.to === b)?.lags).toEqual([1]);
  expect((await links()).find((l) => l.from === b && l.to === c)?.lags).toEqual([1, 2]);
  expect(((await snap(request)).detail.instruments as { variable: string; self_lags: number[] }[]).find((i) => i.variable === c)?.self_lags).toEqual([1]);
  expect((await doIt(request, "set_links", { links: [{ from: a, to: b, lags: [] }] })).did).toContain("removed 1");
  expect((await links()).some((l) => l.from === a && l.to === b)).toBe(false);

  // mark what they are and how sure; select several; group two as one (a mark only: nothing is written)
  expect((await doIt(request, "annotate_variables", { annotations: [{ variable: a, kind: "magic" }] }, 422)).detail).toContain("kind");
  await doIt(request, "annotate_variables", {
    annotations: [
      { variable: a, kind: "setpoint", confidence: "sure" },
      { variable: b, kind: "sensor", confidence: "unsure", note: "?" },
    ],
  });
  const marked = (await snap(request)).detail.instruments as { variable: string; kind?: string; confidence?: string }[];
  expect(marked.find((i) => i.variable === a)).toMatchObject({ kind: "setpoint", confidence: "sure" });
  await doIt(request, "select_variables", { variables: [b, c] });
  expect((await snap(request)).detail.selection).toEqual([b, c]);
  expect((await doIt(request, "group_variables", { variables: [b, c], name: "bc_mean" })).did).toContain("made bc_mean");
  const grouped = (await snap(request)).detail;
  expect((grouped.instruments as { variable: string }[]).some((i) => i.variable === "bc_mean")).toBe(true);
  expect((grouped.notes as Record<string, { group?: unknown }>).bc_mean.group).toEqual({ method: "mean", members: [b, c] });
  expect((grouped.changes as { by: string; text: string }[])[0]).toMatchObject({ by: "AI" });
  expect((grouped.changes as { text: string }[])[0].text).toContain("as bc_mean");
  // a variable already drawn without data (add_variable) can stand for a group; ungroup drops the mark
  await doIt(request, "add_variable", { variable: "ab_max" });
  expect((await doIt(request, "group_variables", { variables: [a, b], name: "ab_max", method: "max" })).did).toContain("used ab_max");
  expect((await doIt(request, "ungroup_variable", { variable: "ab_max" })).did).toContain("ungrouped ab_max");
  expect(((await snap(request)).detail.notes as Record<string, unknown>).ab_max).toBeUndefined();

  expect((await doIt(request, "save_draft", {})).did).toContain("kept the draft");
  const draft = async () => (await (await request.get("/api/live/ui-state")).json()).state?.page;
  await expect.poll(async () => (await draft())?.draft?.exists).toBe(true);
  expect((await draft()).draft).toMatchObject({ dataset: "sim_1_modified", graph_file: (await snap(request)).detail.graph_file });

  // a reload brings the draft back, still unsaved
  await page.reload();
  await expect(page.getByText(/Restored unsaved draft/)).toBeVisible();
  await onePage(request); // the reloaded tab's stream gone: the requests reach the new one
  await doIt(request, "click", { control: "Locked" }); // a reload locks it again
  await expect.poll(async () => (await draft())?.unsaved, { timeout: 20_000 }).toBe(true);
  expect(Math.abs(at(await instruments(), placements[0].variable).x - placements[0].x)).toBeLessThan(0.02);

  // discard: back to the last save, no draft
  await doIt(request, "discard_draft", {});
  await expect.poll(async () => (await draft())?.draft?.exists).toBe(false);
  expect((await snap(request)).detail.unsaved).toBe(false);
  await expect(page.getByText(/Restored unsaved draft/)).toBeHidden();
  await expect.poll(async () => at(await instruments(), placements[0].variable).x).toBe(at(start, placements[0].variable).x);

  // a view: an area with a picture of its own (written at once: the site.json write is mocked); a variable placed
  // in the view's own coordinates lands inside its area
  const sites: { pid_views?: unknown[] }[] = [];
  await page.route("**/api/datasets/sim_1_modified/site", (r) =>
    r.request().method() === "PUT"
      ? (sites.push(r.request().postDataJSON()), r.fulfill({ json: r.request().postDataJSON() }))
      : sites.length
        ? r.fulfill({ json: sites.at(-1) }) // read back what was written (mocked)
        : r.continue(),
  );
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit", (r) => r.fulfill({ json: { removed: false, backup: null } }));
  expect((await doIt(request, "add_view", { name: "Unit", x: 0.5, y: 0.5, w: 2, h: 0.4 }, 422)).detail).toContain("fractions");
  expect((await doIt(request, "add_view", { name: "Unit", x: 0.5, y: 0.5, w: 0.4, h: 0.4 })).did).toContain("made the view Unit (id unit)");
  expect(sites.at(-1)?.pid_views).toEqual([{ id: "unit", name: "Unit", x: 0.5, y: 0.5, w: 0.4, h: 0.4 }]);
  expect((await doIt(request, "place_instruments", { placements: [{ variable: b, x: 0.5, y: 0.5, view: "unit" }] })).did).toContain("placed 1");
  const inView = at(await instruments(), b) as Inst & { view?: string };
  expect(inView.view).toBe("unit");
  expect(Math.abs(inView.x - 0.7)).toBeLessThan(0.02);
  expect((await snap(request)).detail.views).toEqual([
    {
      id: "unit",
      name: "Unit",
      x: 0.5,
      y: 0.5,
      w: 0.4,
      h: 0.4,
      show: "auto",
      shown_as: "sheet",
      picture: false,
      inside: null,
      components: [],
      drawing_texts: 0,
      construct_shapes: 0,
    },
  ]);
  // levels of detail: its own, then all at one level from the layer bar
  expect((await doIt(request, "edit_view", { view: "unit", show: "thumbnail" }, 422)).detail).toContain("show: one of");
  await doIt(request, "edit_view", { view: "unit", show: "box" });
  expect(((await snap(request)).detail.views as { shown_as: string }[])[0].shown_as).toBe("box");
  expect((await doIt(request, "set_layers", { views: "sheet" })).did).toContain("views: all as sheet");
  expect(((await snap(request)).detail.views as { shown_as: string }[])[0].shown_as).toBe("sheet");
  await doIt(request, "set_layers", { views: "own" });
  expect((await (await request.get("/api/live/ui-state")).json()).state.page.views).toEqual(["unit"]);
  // move and shrink it (only w: h follows): the variable in it moves with it
  expect((await doIt(request, "edit_view", { view: "unit", name: "Unit 1", x: 0.1, w: 0.2 })).did).toMatch(/\d+ variables in it moved with it/);
  expect(sites.at(-1)?.pid_views).toEqual([{ id: "unit", name: "Unit 1", x: 0.1, y: 0.5, w: 0.2, h: 0.2, show: "box" }]);
  expect(Math.abs(at(await instruments(), b).x - 0.2)).toBeLessThan(0.02);
  await doIt(request, "move_instrument", { variable: b, x: 0.75, y: 0.5, view: "unit" });
  expect(Math.abs(at(await instruments(), b).x - 0.25)).toBeLessThan(0.02);
  expect((await doIt(request, "open_view", { view: "unit" })).did).toContain("zoomed onto the view Unit 1");
  expect((await snap(request)).detail.view.zoom).toBeGreaterThan(1);
  await doIt(request, "close_view", {});
  expect((await snap(request)).detail.view.zoom).toBe(1);
  expect((await doIt(request, "open_view", { view: "nope" }, 422)).detail).toContain("no view nope");

  // the view's own construct, read from its picture (mocked): a variable goes onto a component by its name
  const tt1 = { id: "inst:0", kind: "circle", x: 0.25, y: 0.5, w: 0.05, h: 0.1, label: "TT1", role: "instrument" };
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit/construct", (r) => r.fulfill({ json: { shapes: [tt1] } }));
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit.png*", (r) =>
    r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>' }),
  );
  await page.reload(); // the page reads the views again (the draft comes back)
  await expect(page.getByText(/Restored unsaved draft/)).toBeVisible(); // the new page, not the one reloaded
  await onePage(request);
  await doIt(request, "click", { control: "Locked" });
  type V = { components: { label: string; role: string; x: number; y: number }[] };
  await expect
    .poll(async () => ((await snap(request)).detail.views as V[] | undefined)?.[0]?.components, { timeout: 20_000 })
    .toEqual([{ label: "TT1", role: "instrument", shape: "inst:0", x: 0.25, y: 0.5 }]);
  expect((await doIt(request, "place_instruments", { placements: [{ variable: b, view: "unit", component: "PT9" }] }, 422)).detail).toContain(
    "Its components: TT1",
  );
  await doIt(request, "place_instruments", { placements: [{ variable: b, view: "unit", component: "tt 1" }] });
  const onTT1 = at(await instruments(), b) as Inst & { tag?: string };
  expect(Math.abs(onTT1.x - 0.15)).toBeLessThan(0.02); // 0.1 + 0.25 of the view's 0.2 width
  expect(Math.abs(onTT1.y - 0.6)).toBeLessThan(0.03);
  expect(((await snap(request)).detail.instruments as { variable: string; tag: string }[]).find((i) => i.variable === b)?.tag).toBe("TT");

  expect((await doIt(request, "remove_view", { view: "unit" })).did).toContain("removed the view Unit 1");
  expect(sites.at(-1)?.pid_views).toEqual([]);
});

test("the assistant moves the Site map", async ({ page, request }) => {
  await page.goto("/#/district/map");
  await expect.poll(async () => (await (await request.get("/api/live/ui-state")).json()).state?.route).toBe("twin/map"); // #/district/map forwards to the whole twin's site map
  const site = (await snap(request)).detail;
  expect(site.examples_on_the_map.length).toBeGreaterThan(0);
  expect((await doIt(request, "map_focus", { example: "Simulation" })).did).toContain("Simulation data center");
});
