/**
 * Data Center > Physical structure (#/dc/pid) interactions, read-only: every write request is aborted, so nothing
 * is saved. Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/structure.spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

const SVG = 'svg[aria-label="P&ID with causal links"]';
const instrument = (page: Page, v: string) => page.locator(`${SVG} g:has(> text:text-is("${v}")) > circle`);
const panel = (page: Page) => page.locator("aside.pid-side"); // the inspector over the drawing, only while something is selected
// the Variables dropdown (closed at first) and the folded box under the drawing: their controls take a click only when open
const toggleList = (page: Page) => page.getByRole("region", { name: "Variables" }).locator("summary").click();
// its summary drops "and legend" where the legend sits in the drawing's margin
const openMore = (page: Page) => page.locator("summary", { hasText: /^Views, documents/ }).click();
// the drawing opens locked every time (PidPage): unlock it where a test drags, pans, zooms or drops
const unlock = (page: Page) => page.getByRole("button", { name: "Locked" }).click();

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await context.addInitScript(() => ["dc", "heat", "district"].forEach((s) => localStorage.setItem(`${s}-structure-edit`, "1"))); // the Structure pages in edit mode (PidPage)
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await readOnly(context);
  await page.goto("/#/dc/pid");
  await expect(instrument(page, "In_Temp")).toBeVisible();
  expect(problems).toEqual([]);
});

test("select a variable, then one of its links, and edit the lags", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  await instrument(page, "In_Temp").click({ force: true });
  await expect(panel(page).getByText("Influenced by")).toBeVisible();
  await panel(page).locator(".pid-chip").first().click();
  await expect(panel(page).locator("strong").first()).toContainText("→");
  const lags = panel(page).getByLabel(/Lags, steps back/);
  await lags.fill("1, 2");
  await lags.press("Enter");
  await expect(lags).toHaveValue("1,2");
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();
  await panel(page).getByRole("button", { name: "Delete link" }).click();
  await expect(panel(page)).toHaveCount(0); // nothing selected: the inspector closes
});

test("add a link by clicking source then target", async ({ page }) => {
  await page.getByRole("button", { name: "+ Add link" }).click();
  await expect(page.getByText("Click the instrument the link starts from.")).toBeVisible();
  await instrument(page, "Out_Temp").click({ force: true });
  await expect(page.getByText("From Out_Temp: now click the instrument it influences.")).toBeVisible();
  await instrument(page, "IT_Load").click({ force: true });
  await expect(panel(page).locator("strong").first()).toHaveText("Out_Temp → IT_Load");
  await expect(page.getByRole("button", { name: "+ Add link" })).toBeVisible();
});

test("drag an instrument: it moves on the grid and the page needs saving", async ({ page }) => {
  await unlock(page);
  const circle = instrument(page, "Out_Temp"); // the weather too: it starts in its box
  const before = await circle.getAttribute("cx");
  const box = (await circle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 20, { steps: 5 });
  await page.mouse.up();
  const after = Number(await circle.getAttribute("cx"));
  expect(String(after)).not.toBe(before);
  expect(after % 10).toBe(0);
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();
});

test("a draft made on an older version of the graph file is dropped: the file as it is now opens", async ({ page }) => {
  await unlock(page);
  const circle = instrument(page, "In_Hum");
  const before = (await circle.getAttribute("cx"))!;
  const box = (await circle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 20, { steps: 5 });
  await page.mouse.up();
  const key = () => page.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("pid-draft:sim_1_modified:")));
  await expect.poll(key).toBeTruthy();
  // the file changed since (saved elsewhere, an example regenerated): the draft's base no longer matches
  await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k!)!);
    localStorage.setItem(k!, JSON.stringify({ ...d, base: "an-older-file" }));
  }, await key());
  await page.reload();
  await expect(instrument(page, "In_Temp")).toBeVisible();
  await expect(page.getByText(/Restored unsaved draft/)).toBeHidden();
  await expect(instrument(page, "In_Hum")).toHaveAttribute("cx", before);
  expect(await key()).toBeUndefined();
});

test("unsaved work survives a reload as a draft; Discard drops it", async ({ page }) => {
  await unlock(page);
  const circle = instrument(page, "In_Hum");
  const before = (await circle.getAttribute("cx"))!;
  const box = (await circle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 20, { steps: 5 });
  await page.mouse.up();
  const after = (await circle.getAttribute("cx"))!;
  expect(after).not.toBe(before);
  await page.getByLabel("Fade P&ID into causal links").fill("0.3");
  // the draft is written a moment after the change
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("pid-draft:sim_1_modified:")))).toBe(true);

  await page.reload();
  await expect(page.getByText(/Restored unsaved draft/)).toBeVisible();
  await expect(instrument(page, "In_Hum")).toHaveAttribute("cx", after);
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();
  await expect(page.getByLabel("Fade P&ID into causal links")).toHaveValue("0.3");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText(/Restored unsaved draft/)).toBeHidden();
  await expect(instrument(page, "In_Hum")).toHaveAttribute("cx", before);
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  await page.reload();
  await expect(instrument(page, "In_Temp")).toBeVisible();
  await expect(page.getByText(/Restored unsaved draft/)).toBeHidden();
  await expect(instrument(page, "In_Hum")).toHaveAttribute("cx", before);
});

test("slider stages: graph in place, then the circle (no dragging there)", async ({ page }) => {
  const circle = instrument(page, "In_Temp");
  const onPid = await circle.getAttribute("cx");
  await page.getByRole("button", { name: "Graph in place" }).click();
  await expect(page.getByRole("button", { name: "Graph in place" })).toHaveAttribute("aria-pressed", "true");
  await expect(circle).toHaveAttribute("cx", onPid!);
  await page.getByRole("button", { name: "Causal graph" }).click();
  await expect(circle).not.toHaveAttribute("cx", onPid!);
  const onCircle = await circle.getAttribute("cx");
  const box = (await circle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y, { steps: 4 });
  await page.mouse.up();
  await expect(circle).toHaveAttribute("cx", onCircle!); // a drag pans the view, the instrument stays
  await circle.click({ force: true }); // a click selects
  await expect(panel(page).locator("strong").first()).toHaveText("In_Temp");
});

test("the Variables menu keeps only the variables made one way, as Modelling shows it; Show / Hide act on those", async ({ page }) => {
  const menu = page.getByRole("region", { name: "Variables" });
  await toggleList(page);
  const chips = menu.getByRole("group", { name: "Only the variables made this way" });
  const chip = (name: string) => chips.getByRole("button", { name: new RegExp(`^${name}`) });
  for (const n of ["Not modelled", "Data-driven", "Physical", "Profile"]) await expect(chip(n)).toHaveAttribute("aria-pressed", "false");
  await expect(chip("Calculated")).toHaveCount(0); // no calculated variable on this drawing
  await chip("Data-driven").click();
  await chip("Profile").click(); // any combination
  await expect(chip("Data-driven")).toHaveAttribute("aria-pressed", "true");
  await expect(menu.getByLabel("Show In_Temp")).toBeVisible(); // learned from the data
  await expect(menu.getByLabel("Show Heat_rejected")).toBeVisible(); // no data: a profile
  await expect(menu.getByLabel("Show Out_Temp")).toHaveCount(0); // the weather: taken from the data, not modelled
  await menu.getByRole("button", { name: "Hide these" }).click();
  await expect(instrument(page, "In_Temp")).toHaveCount(0);
  await expect(instrument(page, "Out_Temp")).toBeVisible(); // not listed: left as it was
  await chip("Data-driven").click();
  await chip("Profile").click();
  await expect(menu.getByLabel("Show Out_Temp")).toBeVisible();
  await expect(menu.getByRole("button", { name: "Show all" })).toBeVisible();
});

test("+ Variable rejects duplicates and marks names without data", async ({ page }) => {
  await page.getByRole("button", { name: "+ Variable" }).click();
  const name = page.getByRole("region", { name: "Variables" }).getByLabel("Variable name"); // under the button, in the Variables bar
  await expect(name).toBeFocused();
  await name.fill("IT_Load");
  await name.press("Enter");
  await expect(page.getByText("IT_Load is already on the drawing.")).toBeVisible();
  await name.fill("My_New_Temp");
  await name.press("Enter");
  await expect(page.getByText(/My_New_Temp is not in the data/)).toBeVisible();
  await expect(page.locator(`${SVG} text:text-is("no data")`)).toHaveCount(2); // and the heat to the environment (no column); the shared weather's sun is not the data center's without data
  await expect(name).toHaveCount(0); // added: the field closes
  await page.getByRole("button", { name: "+ Variable" }).click();
  await name.press("Escape"); // Escape closes it too
  await expect(name).toHaveCount(0);
});

test("Save as checks the file name before saving", async ({ page }) => {
  await page.getByRole("button", { name: "Save as…" }).click();
  const name = page.getByLabel("New graph file name");
  await expect(name).toHaveValue("causal_graph_pcmci_lags.json");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await name.fill("mine");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await name.fill("site.json");
  await expect(page.getByText("site.json is not a graph file: pick another name.")).toBeVisible();
});

test("heat recovery choice switches the exchanger and shows only its three variables; Q is a read-out; Save keeps the hidden ones", async ({ page }) => {
  const hexVars = (k: string) => page.locator(`${SVG} g > text:not(.pid-inst__full)`).filter({ hasText: new RegExp(`^HEX_${k}_`) });
  const readout = (q: string) => page.locator(`${SVG} text[aria-label^="${q} = m · cp · (T_in − T_out), calculated"]`);
  // the page opens on the saved option (site.json hex_option); start from the condenser either way
  await page.getByRole("button", { name: "Condenser HEX" }).click();
  for (const v of ["HEX_Cond_T_in", "HEX_Cond_T_out", "HEX_Cond_m", "Heat_Demand"]) await expect(instrument(page, v)).toBeVisible();
  await expect(hexVars("Cond")).toHaveCount(3); // T_in, T_out, m: Q is calculated, not an instrument
  await expect(hexVars("Hall")).toHaveCount(0);
  await expect(readout("HEX_Cond_Q")).toContainText(/Q = ṁ·cₚ·ΔT\s*mean \d+,\d kW/);
  await page.getByRole("button", { name: "Hall HEX" }).click();
  await expect(page.getByRole("button", { name: "Hall HEX" })).toHaveAttribute("aria-pressed", "true");
  for (const v of ["HEX_Hall_T_in", "HEX_Hall_T_out", "HEX_Hall_m"]) await expect(instrument(page, v)).toBeVisible();
  await expect(hexVars("Hall")).toHaveCount(3);
  await expect(hexVars("Cond")).toHaveCount(0);
  await expect(readout("HEX_Hall_Q")).toContainText("cₚ 1.006");
  // the save is caught here and aborted: the hidden condenser variables and their links are still in it
  let saved: { targets: Record<string, [string, number][]> } | null = null;
  await page.route("**/graph/save", (r) => {
    saved = r.request().postDataJSON();
    return r.abort();
  });
  await page.getByRole("button", { name: /^Save to / }).click();
  // ... and no calculated Q: it is not a graph node
  await expect
    .poll(() =>
      saved
        ? Object.keys(saved.targets)
            .filter((v) => v.startsWith("HEX_"))
            .sort()
        : [],
    )
    .toEqual(["HEX_Cond_T_in", "HEX_Cond_T_out", "HEX_Cond_m", "HEX_Hall_T_in", "HEX_Hall_T_out", "HEX_Hall_m"]);
});

test("paper P&ID with an extracted plant: no assignment panel; each diagram keeps its unsaved positions", async ({ page }) => {
  // a simulation with a mocked P&ID image and plant: diagram switch
  await page.route("**/api/datasets", async (r) => {
    const res = await r.fetch();
    const json = await res.json();
    for (const d of json.datasets) if (d.id === "sim_1_modified") d.config = { ...d.config, pid_image: "pid.png" };
    await r.fulfill({ response: res, json });
  });
  await page.route("**/api/datasets/sim_1_modified/pid.png", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#eee"/></svg>',
    }),
  );
  await page.route("**/api/datasets/sim_1_modified/pid/plant", (r) =>
    r.fulfill({
      json: {
        components: [
          { id: "c1", label: "HEX Cond", x: 0.3, y: 0.3 },
          { id: "c2", label: "Chiller", x: 0.6, y: 0.5 },
        ],
        links: [["c1", "c2"]],
        pipes: [
          [
            [0.1, 0.1],
            [0.5, 0.1],
          ],
        ],
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Paper P&ID" })).toHaveAttribute("aria-pressed", "true");
  await expect(instrument(page, "Out_Temp")).toHaveCount(0); // not placed yet: not drawn, nothing below the picture
  await expect(panel(page).getByText("Variables → P&ID component")).toHaveCount(0); // no assignment panel
  await page.getByRole("region", { name: "Variables" }).getByLabel("Show Out_Temp").check(); // placed on the picture
  const x = Number(await instrument(page, "Out_Temp").getAttribute("cx"));
  // switching diagrams keeps the unsaved positions of each
  await page.getByRole("button", { name: "Drawn P&ID" }).click();
  await expect(page.getByText("Rack rows", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paper P&ID" }).click();
  await expect(instrument(page, "Out_Temp")).toHaveAttribute("cx", String(x));
});

test("causal discovery (TempCaFe): the found lags bring their strengths to the inspector and the save payload", async ({ page }) => {
  // discovery mocked (found: lag 2 on every link); the save is caught here and aborted
  await page.route("**/graph/discover-lags", (r) => {
    const { links } = r.request().postDataJSON() as { links: { source: string; target: string }[] };
    r.fulfill({
      json: {
        links: links.map((l) => ({ ...l, lags: [2], p: { "2": 0 } })),
        self: {},
        skipped: [],
        link_strengths: links.map((l) => ({ ...l, lag: -2, value: 0.5 })),
      },
    });
  });
  let saved: { link_strengths: { source: string; target: string; lag: number }[] } | null = null;
  await page.route("**/graph/save", (r) => {
    saved = r.request().postDataJSON();
    return r.abort();
  });
  await page.getByRole("button", { name: "Causal discovery" }).click();
  await page.getByRole("dialog", { name: "Causal discovery" }).getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("status")).toContainText("Lags updated for");
  await instrument(page, "In_Temp").click({ force: true });
  await panel(page).locator(".pid-chip").first().click();
  await expect(panel(page).getByTestId("link-strengths")).toContainText("lag 2: 0,50"); // fmt: German decimals
  await page.getByRole("button", { name: /^Save to / }).click();
  await expect.poll(() => saved?.link_strengths.filter((s) => s.lag === -2).length ?? 0).toBeGreaterThan(0);
});

test("zoom, pan and lock the drawing; the Causal discovery menu explains itself and closes", async ({ page }) => {
  const svg = page.locator(SVG);
  // it opens locked: the zoom buttons are off until it is unlocked
  await expect(page.getByRole("button", { name: "Locked" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  await unlock(page);
  // the whole drawing once the page has settled (read on load, a scrollbar coming in still moved it)
  let whole: string | null = null;
  await expect
    .poll(
      async () => {
        const v = await svg.getAttribute("viewBox");
        const settled = v === whole;
        whole = v;
        return settled;
      },
      { intervals: [400] },
    )
    .toBe(true);
  // at 100 % too, a drag on the empty drawing moves it; Fit centres it again
  const edge = (await svg.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 12);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 150, edge.y + 60, { steps: 5 });
  await page.mouse.up();
  expect(await svg.getAttribute("viewBox")).not.toBe(whole);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(svg).toHaveAttribute("viewBox", whole!);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator(".pid-zoom__pct")).toHaveText("125%");
  const zoomed = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
  expect(zoomed[2]).toBeLessThan(Number(whole!.split(" ")[2]));
  // dragging the empty drawing (its top edge, above the instruments) pans
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 40, { steps: 5 });
  await page.mouse.up();
  expect((await svg.getAttribute("viewBox"))!.split(" ").map(Number)[0]).toBeGreaterThan(zoomed[0]);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(svg).toHaveAttribute("viewBox", whole!);

  // locked, nothing moves: no drag of an instrument, no pan, no zoom (wheel or buttons); a click still selects
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Lock" }).click();
  for (const name of ["Zoom in", "Zoom out", "Fit"]) await expect(page.getByRole("button", { name })).toBeDisabled();
  const frozen = await svg.getAttribute("viewBox");
  const inView = instrument(page, "In_Temp");
  const cx = await inView.getAttribute("cx");
  const on = (await inView.boundingBox())!;
  const drag = async (x: number, y: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 120, y - 40, { steps: 5 });
    await page.mouse.up();
  };
  await drag(on.x + on.width / 2, on.y + on.height / 2); // from an instrument
  const top = (await svg.boundingBox())!;
  await drag(top.x + top.width / 2, top.y + 12); // from the empty drawing
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.wheel(0, -300);
  expect(await inView.getAttribute("cx")).toBe(cx);
  await expect(svg).toHaveAttribute("viewBox", frozen!);
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
  await inView.click({ force: true });
  await expect(panel(page).locator("strong").first()).toHaveText("In_Temp");
  await page.getByRole("button", { name: "Locked" }).click();
  await expect(page.getByRole("button", { name: "Fit" })).toBeEnabled();

  // the Causal discovery menu explains itself; Escape and a click elsewhere close it
  const open = page.getByRole("button", { name: "Causal discovery" });
  await expect(open).toHaveAttribute("aria-haspopup", "dialog");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Causal discovery" })).toContainText("Temporal Causal Feature Selection");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Causal discovery" })).toHaveCount(0);
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await page.locator(".pid-intro p").click(); // a click outside (the title is for screen readers only)
  await expect(page.getByRole("dialog", { name: "Causal discovery" })).toHaveCount(0);
});

test("blind causal discovery: every pair of the drawn variables with data is tested, the drawn links are not a prior", async ({ page }) => {
  // discovery mocked: only In_Temp -> Out_Temp found, at lag 3; the request is caught to check what was asked
  let asked: { links: { source: string; target: string }[]; method: string; alpha: number; min_lag: number; max_lag: number } | null = null;
  await page.route("**/graph/discover-lags", (r) => {
    asked = r.request().postDataJSON();
    r.fulfill({
      json: {
        links: asked!.links.map((l) => ({ ...l, lags: l.source === "In_Temp" && l.target === "Out_Temp" ? [3] : [], p: {} })),
        self: {},
        skipped: [],
        link_strengths: [],
      },
    });
  });
  await page.getByRole("button", { name: "Causal discovery" }).click();
  const menu = page.getByRole("dialog", { name: "Causal discovery" });
  await menu.getByLabel("Blind, no links").check();
  await menu.getByLabel("Method").selectOption("pc");
  await menu.getByLabel("Significance level (alpha)").selectOption("0.05");
  await menu.getByLabel("Largest lag").fill("3");
  await menu.getByRole("button", { name: "Run" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Found 1 links among");
  const n = new Set(asked!.links.map((l) => l.source)).size;
  expect(asked!.links).toHaveLength(n * (n - 1)); // every ordered pair
  expect(asked).toMatchObject({ method: "pc", alpha: 0.05, min_lag: 1, max_lag: 3 });
  await instrument(page, "In_Temp").click({ force: true });
  await expect(panel(page).locator(".pid-chip")).toHaveCount(1); // only the found link is left
});

test("import: the preview comes first, then the area is selected and only it is read and used (mocked)", async ({ page }) => {
  const crops: (string | null)[] = [];
  const read = { viewBox: "0 0 400 300", colorRuns: [], colorNodes: [], colorConnections: [], edges: [], warnings: [], components: [], links: [] };
  const stats = { components: 0, connections: 0, pipeSegments: 0, colorRuns: 0, nodes: 0, edges: 0, instruments: 0, elapsedSeconds: 0 };
  await page.route("**/api/pid/extract**", (r) => {
    crops.push(new URL(r.request().url()).searchParams.get("crop"));
    return r.fulfill({ json: { ...read, stats } });
  });
  // a white 400 x 300 page as the preview
  await page.route("**/api/pid/preview", async (r) => {
    const png = await page.evaluate(() => {
      const c = Object.assign(document.createElement("canvas"), { width: 400, height: 300 });
      c.getContext("2d")!.fillRect(0, 0, 1, 1);
      return c.toDataURL("image/png").split(",")[1];
    });
    await r.fulfill({ body: Buffer.from(png, "base64"), contentType: "image/png" });
  });
  let used: string | null = null;
  await page.route("**/api/datasets/sim_1_modified/pid?**", (r) => {
    used = new URL(r.request().url()).searchParams.get("crop");
    return r.abort(); // the page would reload: the request is all this test needs
  });

  await page.getByRole("button", { name: /Import P&ID/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import a P&ID" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "sheet.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  // the preview, ready for the area: nothing is read yet
  await expect(dialog.getByRole("img", { name: "Drag a rectangle over the part to read" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Whole page" })).toBeVisible();
  expect(crops).toEqual([]);
  const sheet = dialog.getByRole("img", { name: "The drawing", exact: true });
  await sheet.scrollIntoViewIfNeeded();
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.4, { steps: 4 });
  await page.mouse.up();
  await expect(dialog.getByRole("button", { name: "Select another area" })).toBeVisible();
  expect(crops).toHaveLength(1); // read once, only the area
  const [x0, y0, x1, y1] = crops[0]!.split(",").map(Number);
  expect([x0, y0, x1, y1].map((v) => Math.round(v * 20) / 20)).toEqual([0.25, 0.1, 0.9, 0.4]);

  await dialog.getByRole("button", { name: "Use as the P&ID of this data center" }).click();
  await expect.poll(() => used).toBe(crops[0]);
});

test("the Variables menu: hide and show variables, search, size; the wheel zooms the drawing", async ({ page }) => {
  const menu = page.getByRole("region", { name: "Variables" });
  await expect(menu.getByText("16 of 16 shown")).toBeVisible(); // the other heat-recovery option's three are not counted; Heat_rejected is (no data), the sun not (no data, nothing needs it)
  await toggleList(page);
  await menu.getByLabel("Show Out_Temp").uncheck();
  await expect(instrument(page, "Out_Temp")).toHaveCount(0);
  await menu.getByLabel("Search variables").fill("hex_cond");
  await menu.getByRole("button", { name: "Hide these" }).click();
  await expect(instrument(page, "HEX_Cond_T_in")).toHaveCount(0);
  await menu.getByRole("button", { name: "Show these" }).click();
  await expect(instrument(page, "HEX_Cond_T_in")).toBeVisible();
  // clicking a name shows it and selects it
  await menu.getByLabel("Search variables").fill("Out_Temp");
  await menu.getByRole("button", { name: "Out_Temp", exact: true }).click();
  await expect(instrument(page, "Out_Temp")).toBeVisible();
  await expect(panel(page)).toContainText("Influenced by");

  await menu.getByLabel("Instrument size").fill("1.5");
  await expect(page.locator(`${SVG} g[transform]:has(> text:text-is("In_Temp"))`)).toHaveAttribute("transform", /scale\(1\.5\)/);

  await toggleList(page); // closed: the dropdown covers the drawing's top
  await unlock(page);
  const svg = page.locator(SVG);
  const whole = await svg.getAttribute("viewBox");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number((await svg.getAttribute("viewBox"))!.split(" ")[2])).toBeLessThan(Number(whole!.split(" ")[2]));
});

test("a row of the Variables list under the pointer shows its whole name", async ({ page }) => {
  await toggleList(page);
  const name = page.getByRole("region", { name: "Variables" }).locator(".pid-vars__name").first();
  expect(await name.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
  await name.hover();
  expect(await name.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("normal");
});

test("paper P&ID: a variable ticked in the menu appears on the picture, one dragged from it lands where dropped", async ({ page }) => {
  await page.route("**/api/datasets", async (r) => {
    const res = await r.fetch();
    const json = await res.json();
    for (const d of json.datasets) if (d.id === "sim_1_modified") d.config = { ...d.config, pid_image: "pid.png" };
    await r.fulfill({ response: res, json });
  });
  await page.route("**/api/datasets/sim_1_modified/pid.png", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#eee"/></svg>',
    }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Paper P&ID" })).toHaveAttribute("aria-pressed", "true");
  await unlock(page); // the drop below needs it
  const picture = 550; // the picture's height at width 1100: the whole canvas
  const menu = page.getByRole("region", { name: "Variables" });
  const cy = async (v: string) => Number(await instrument(page, v).getAttribute("cy"));
  await expect(instrument(page, "In_Temp")).toHaveCount(0); // not placed yet: not drawn, unticked in the menu
  await toggleList(page);
  await expect(menu.getByLabel("Show In_Temp")).not.toBeChecked();
  // the standard ones start beside the picture, in the connection point's margin: the weather, the extraction point's water
  for (const v of ["Out_Temp", "HEX_Hall_T_in"]) expect(Number(await instrument(page, v).getAttribute("cx"))).toBeGreaterThan(1100);
  expect(Number((await page.locator(SVG).getAttribute("data-live-whole"))!.split(" ")[3])).toBe(picture); // nothing below it

  await menu.getByLabel("Show In_Temp").check();
  expect(await cy("In_Temp")).toBeLessThan(picture); // appeared on the picture
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();

  const svg = (await page.locator(SVG).boundingBox())!;
  await menu.getByLabel("Search variables").fill("In_Hum"); // a short list: the open dropdown does not cover the drop point
  await menu.getByRole("button", { name: "In_Hum", exact: true }).dragTo(page.locator(SVG), { targetPosition: { x: svg.width / 2, y: svg.height / 2 } });
  const vb = (await page.locator(SVG).getAttribute("viewBox"))!.split(" ").map(Number);
  // where dropped: the canvas's middle, the view's (the picture and, right of it, the connection point's margin)
  expect(Math.abs(Number(await instrument(page, "In_Hum").getAttribute("cx")) - (vb[0] + vb[2] / 2))).toBeLessThanOrEqual(10);
  expect(Math.abs((await cy("In_Hum")) - (vb[1] + vb[3] / 2))).toBeLessThanOrEqual(10);

  // Show all puts them on the picture: the drawing keeps its size
  const whole = async () => Number((await page.locator(SVG).getAttribute("data-live-whole"))!.split(" ")[3]);
  await menu.getByLabel("Search variables").fill("");
  await menu.getByRole("button", { name: "Hide all" }).click();
  await menu.getByRole("button", { name: "Show all" }).click();
  expect(await whole()).toBe(picture);
});

test("a P&ID taller than the window fits it; the wheel zooms in and a drag pans down to its bottom", async ({ page }) => {
  await page.route("**/api/datasets", async (r) => {
    const res = await r.fetch();
    const json = await res.json();
    for (const d of json.datasets) if (d.id === "sim_1_modified") d.config = { ...d.config, pid_image: "pid.png" };
    await r.fulfill({ response: res, json });
  });
  await page.route("**/api/datasets/sim_1_modified/pid.png", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="3000"><rect width="1000" height="3000" fill="#eee"/></svg>',
    }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Paper P&ID" })).toHaveAttribute("aria-pressed", "true");
  const svg = page.locator(SVG);
  await unlock(page);
  const viewBox = async () => (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
  const whole = Number((await svg.getAttribute("data-live-whole"))!.split(" ")[3]);
  // the whole drawing in the canvas; scrolled to the drawing's end (the variables to model follow), all of it is on screen
  await page.locator(".pid-main").evaluate((m) => m.scrollIntoView({ block: "end" }));
  const box = (await svg.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect((await viewBox())[3]).toBeGreaterThanOrEqual(whole - 1);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await viewBox())[3]).toBeLessThan(whole / 2);
  // drag up on the empty drawing (its left edge, past the instruments) until the bottom is in view
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box.x + 6, box.y + box.height - 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 6, box.y + 10, { steps: 4 });
    await page.mouse.up();
  }
  const [, y, , h] = await viewBox();
  expect(y + h).toBeGreaterThanOrEqual(whole); // the bottom edge is in view
});

test("select several with a box, mark their kind, group them into one (a mark only); the Changes box tells what happened", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => r.method() !== "GET" && r.url().includes("/api/datasets/") && writes.push(r.url()));
  // a box around In_Hum and In_Temp, drawn in Select mode
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const [a, b] = [(await instrument(page, "In_Hum").boundingBox())!, (await instrument(page, "In_Temp").boundingBox())!];
  await page.mouse.move(a.x - 12, a.y - 12);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 12, b.y + b.height + 12, { steps: 5 });
  await page.mouse.up();
  const bar = page.getByRole("group", { name: "Selected variables" });
  await expect(bar.getByText("2 selected")).toBeVisible();

  await bar.getByLabel("Mark the kind").selectOption("sensor");
  await bar.getByLabel("Mark how sure").selectOption("likely");
  await expect(page.locator(SVG).locator("title", { hasText: "Sensor (measured value)" })).toHaveCount(2); // in the hover text of both, no badge
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();

  await bar.getByRole("button", { name: "Group…" }).click();
  await expect(bar.getByLabel("Group name")).toHaveValue("In_mean");
  await bar.getByRole("button", { name: "Make group" }).click();
  await expect(instrument(page, "In_mean")).toBeVisible();
  await expect(instrument(page, "In_Temp")).toHaveCount(0); // the members are hidden
  await expect(page.locator(SVG).getByText("mean of 2")).toBeVisible();
  expect(writes).toEqual([]); // only a mark: nothing is computed or written before Save
  const side = page.getByRole("complementary", { name: "Selection", exact: true });
  await expect(side).toContainText("In_Hum, In_Temp");

  await openMore(page);
  const log = page.getByRole("list", { name: "Changes on this page" });
  await expect(log).toContainText("grouped 2 variables (In_Hum, In_Temp) as In_mean, their mean");
  await expect(log).toContainText("marked In_Hum, In_Temp: sensor");

  await side.getByRole("button", { name: "Ungroup" }).click();
  await expect(instrument(page, "In_Temp")).toBeVisible(); // the members are back
  await expect(log).toContainText("ungrouped In_mean");

  // the whole name of an instrument shows while the pointer rests on it
  await instrument(page, "IT_Load").hover({ force: true });
  await expect(page.locator(".pid-inst__full", { hasText: "IT_Load" })).toBeVisible();
});

test("mark an area as a view, give it a picture of its own and open it (the writes are mocked)", async ({ page }) => {
  const sites: { pid_views?: { id: string; h: number }[] }[] = [];
  // site.json as written last (the writes are mocked, so the page reads its own back)
  await page.route("**/api/datasets/sim_1_modified/site", (r) =>
    r.request().method() === "PUT"
      ? (sites.push(r.request().postDataJSON()), r.fulfill({ json: r.request().postDataJSON() }))
      : sites.length
        ? r.fulfill({ json: sites.at(-1) })
        : r.continue(),
  );
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit-a", (r) =>
    r.fulfill({ json: { view: "unit-a", width: 200, height: 100, bytes: 1, backup: null, shapes: 1, note: null } }),
  );
  const tt1 = { id: "inst:0", kind: "circle", x: 0.3, y: 0.5, w: 0.05, h: 0.1, label: "TT1", role: "instrument" };
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit-a/construct", (r) => r.fulfill({ json: { shapes: [tt1] } }));
  await page.route("**/api/datasets/sim_1_modified/pid/views/unit-a.png*", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ddd"/></svg>',
    }),
  );
  const svg = page.locator(SVG);
  const screen = (x: number, y: number) =>
    svg.evaluate((el, [x, y]) => new DOMPoint(x, y).matrixTransform((el as SVGSVGElement).getScreenCTM()!), [x, y] as const);

  // drag a box over an empty part of the drawing, then name it
  await unlock(page);
  await openMore(page);
  await page.getByRole("button", { name: "Mark an area as a view" }).click();
  // a click in the box under the drawing scrolls the drawing's top under the page's header: back, bottom-aligned
  const toTop = () => svg.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await toTop();
  const [a, b] = [await screen(60, 105), await screen(420, 185)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.getByLabel("Name of the new view").fill("Unit A");
  await page.getByRole("button", { name: "Make view" }).click();
  await expect(svg.getByText("▣ Unit A")).toBeVisible();
  expect(sites.at(-1)?.pid_views?.map((v) => v.id)).toEqual(["unit-a"]);

  const unitA = svg.locator('g.pid-view[aria-label="View Unit A"]');
  await expect(unitA).toHaveAttribute("data-shown-as", "sheet"); // no picture yet: the sheet it holds
  const status = page.getByLabel("Construct of Unit A");
  await expect(status).toContainText("no picture yet");

  // a picture (the backend gives the area the picture's shape: tests/pid/test_pid_api.py); auto: a box while small
  await page.getByLabel("Picture of Unit A").setInputFiles({ name: "unit.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(unitA).toHaveAttribute("data-shown-as", "box");
  await expect(svg.locator('image[href*="/pid/views/unit-a.png"]')).toHaveCount(0);
  await expect(status).toHaveText("construct: 1 shapes, 1 components and instruments"); // the app says what it could read
  await expect(page.getByText("its construct read from it (1 shapes)")).toBeVisible();

  // open it: the drawing zooms onto the view, which now shows its picture
  const width = async () => Number((await svg.getAttribute("viewBox"))!.split(" ")[2]);
  const whole = await width();
  await page.getByRole("list", { name: "Views of the P&ID" }).getByRole("button", { name: "▣ Unit A" }).click();
  await expect.poll(width).toBeLessThan(whole / 2);
  await expect(unitA).toHaveAttribute("data-shown-as", "picture");
  await expect(svg.locator('image[href*="/pid/views/unit-a.png"]')).toHaveCount(1);
  await expect(unitA.locator("text", { hasText: "TT1" })).toBeVisible(); // its own construct, read from its picture
  // a window onto its picture: opaque, drawn over the digital construct (the sheet's lines and texts), under the variables
  await expect(svg.locator(".pid-view__panel")).toHaveCount(1);
  const order = await svg.evaluate((el) => {
    const all = [...el.querySelectorAll('g[aria-label="Digital construct"], .pid-view, .pid-inst')];
    return all.map((n) => (n.matches(".pid-view") ? "view" : n.matches(".pid-inst") ? "variable" : "construct"));
  });
  expect(order.indexOf("view")).toBeGreaterThan(order.indexOf("construct"));
  expect(order.indexOf("view")).toBeLessThan(order.indexOf("variable"));

  await page.getByRole("button", { name: "Back to the whole P&ID" }).click();
  await expect.poll(width).toBe(whole);
  await expect(unitA).toHaveAttribute("data-shown-as", "box");
  await expect(unitA.locator("text", { hasText: "TT1" })).toHaveCount(0); // a box: no detail
  // a double click on the view opens it too
  await toTop();
  const mid = await screen(240, 130);
  await page.mouse.dblclick(mid.x, mid.y);
  await expect.poll(width).toBeLessThan(whole / 2);
  await page.getByRole("button", { name: "Back to the whole P&ID" }).click();
  await expect.poll(width).toBe(whole);

  // its own level, then every view at one level from the layer bar, then each its own again
  await page.getByLabel("Show Unit A as").selectOption("sheet");
  await expect(unitA).toHaveAttribute("data-shown-as", "sheet");
  expect(sites.at(-1)?.pid_views?.[0]).toMatchObject({ show: "sheet" });
  await page.getByLabel("Show the views as").selectOption("picture");
  await expect(unitA).toHaveAttribute("data-shown-as", "picture");
  await page.getByLabel("Show the views as").selectOption("own");
  await expect(unitA).toHaveAttribute("data-shown-as", "sheet");
  await expect(page.getByRole("list", { name: "Changes on this page" })).toContainText("gave the view Unit A a picture");
});

test("documents about the data center: add one with a note, change the note, remove it (the writes are mocked)", async ({ page }) => {
  let docs: { name: string; path: string; bytes: number; modified: string; note: string; view: string }[] = [];
  const sent: string[] = [];
  await page.route("**/api/datasets/sim_1_modified/documents**", async (r) => {
    const url = new URL(r.request().url());
    const method = r.request().method();
    sent.push(`${method} ${decodeURIComponent(url.pathname.split("/documents")[1])}${url.search}`);
    if (method === "GET") return r.fulfill({ json: { documents: docs, about: "" } });
    if (method === "POST") {
      docs = [{ name: "racks.md", path: "/x/racks.md", bytes: 12, modified: "2026-10-27T10:00:00", note: url.searchParams.get("note") ?? "", view: "" }];
      return r.fulfill({ json: { name: "racks.md", path: "/x/racks.md", bytes: 12, backup: null } });
    }
    if (method === "PUT") {
      docs = docs.map((d) => ({ ...d, ...r.request().postDataJSON() }));
      return r.fulfill({ json: { name: "racks.md", note: docs[0].note, view: docs[0].view } });
    }
    docs = [];
    return r.fulfill({ json: { removed: true, backup: ".backup/x" } });
  });
  await page.reload();
  await openMore(page);
  const box = page.locator("details.pid-changes", { has: page.getByText("Documents", { exact: true }) });
  await box.locator("summary").click();
  await box.getByLabel("Note for the next document").fill("rack water loop");
  await box.getByLabel("Add a document").setInputFiles({ name: "racks.md", mimeType: "text/markdown", buffer: Buffer.from("# Rack loop\n") });
  await expect(page.getByText("Kept racks.md: an assistant can read it now.")).toBeVisible();
  await expect(box.getByRole("list", { name: "Documents of the data center" })).toContainText("racks.md");
  expect(sent).toContain("POST /racks.md?note=rack+water+loop");

  const note = box.getByLabel("Note of racks.md");
  await expect(note).toHaveValue("rack water loop");
  await note.fill("valves 3 and 4");
  await note.press("Enter");
  await expect.poll(() => sent.some((s) => s.startsWith("PUT /racks.md/info"))).toBe(true);
  await expect(box.getByRole("link", { name: "racks.md" })).toHaveAttribute("href", /documents\/racks\.md$/); // opens the file

  page.once("dialog", (d) => d.accept());
  await box.getByRole("button", { name: "Remove the document racks.md" }).click();
  await expect(box.getByRole("list", { name: "Documents of the data center" })).toHaveCount(0);
});

test("rename a variable, then several at once by find and replace; the data keeps its own names (the save is mocked)", async ({ page }) => {
  let names: Record<string, string> = {};
  const sent: Record<string, string>[] = [];
  await page.route("**/api/datasets/sim_1_modified/names", async (r) => {
    const asked = r.request().postDataJSON().names as Record<string, string>;
    sent.push(asked);
    names = Object.fromEntries(Object.entries({ ...names, ...asked }).filter(([, n]) => n));
    await r.fulfill({ json: { names } });
  });
  await instrument(page, "In_Temp").click({ force: true });
  const name = panel(page).getByLabel("Name shown (the data keeps its own)");
  await name.fill("Room temperature");
  await name.press("Enter");
  await expect(instrument(page, "Room temperature")).toBeVisible(); // drawn with the name shown
  await expect(panel(page).getByTitle("Its own name, as in the data")).toHaveText("In_Temp");
  expect(sent).toEqual([{ In_Temp: "Room temperature" }]);

  // bulk: a box around In_Hum and Room temperature, then find and replace in the names shown (the inspector closed: it covers them)
  await panel(page).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const [a, b] = [(await instrument(page, "In_Hum").boundingBox())!, (await instrument(page, "Room temperature").boundingBox())!];
  await page.mouse.move(a.x - 12, a.y - 12);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 12, b.y + b.height + 12, { steps: 5 });
  await page.mouse.up();
  const bar = page.getByRole("group", { name: "Selected variables" });
  await bar.getByRole("button", { name: "Rename…" }).click();
  await bar.getByLabel("Find in the names").fill("^(In_|Room )");
  await bar.getByLabel("Replace with").fill("Hall ");
  await expect(bar.getByText("not a valid pattern")).toHaveCount(0);
  await bar.getByText("Pattern").click();
  await expect(bar.getByText("2 of 2 names change")).toBeVisible();
  await bar.getByRole("button", { name: "Rename", exact: true }).click();
  expect(sent.at(-1)).toEqual({ In_Hum: "Hall Hum", In_Temp: "Hall temperature" });
  await expect(instrument(page, "Hall Hum")).toBeVisible();
  await openMore(page);
  await expect(page.getByRole("list", { name: "Changes on this page" })).toContainText("renamed 2 variables");
});

test("the blank example: the data center's box is the surface, every variable drags, its bottom edge makes it taller", async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_blank")); // after the beforeEach's: it wins
  await page.reload();
  await expect(page.locator(`${SVG} g[aria-label="Data center"]`)).toBeVisible();
  await unlock(page);
  // an input above the box drags too (into the box, if wanted)
  const out = instrument(page, "T_outdoor");
  const at = await out.getAttribute("cx");
  const box = (await out.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(out).not.toHaveAttribute("cx", at!);
  // a variable added goes inside the box, and drags there
  await page.getByRole("button", { name: "+ Variable" }).click();
  await page.getByLabel("Variable name").fill("Chiller_load");
  await page.getByLabel("Variable name").press("Enter");
  const added = instrument(page, "Chiller_load");
  await expect(added).toBeVisible();
  const from = (await added.boundingBox())!;
  const cx = await added.getAttribute("cx");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 160, from.y + from.height / 2 + 120, { steps: 6 });
  await page.mouse.up();
  await expect(added).not.toHaveAttribute("cx", cx!);
  // the surface: its handle, by the keys, 80 a step; the page needs saving then
  const handle = page.getByRole("slider", { name: "Surface height" });
  const h = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow", String(h + 80));
  await expect(page.getByRole("button", { name: /^Save to / })).toBeEnabled();
});

test("KPI variables: the button marks the variables the KPIs use and writes their formulas", async ({ page }) => {
  await page.goto("/#/dc/pid");
  const button = page.getByRole("button", { name: "KPI variables", exact: true });
  await button.click({ timeout: 30_000 });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const kpis = page.getByRole("list", { name: "KPIs and their variables" });
  await expect(kpis.getByText("(ITE_Ener + HVAC_Ener) / ITE_Ener")).toBeVisible(); // PUE with the bound names
  // the IT power marked on the drawing, and the condenser's water for the reused heat calculated from it
  await expect(page.locator(SVG).locator("title", { hasText: "IT power · PUE" })).toHaveCount(1);
  await expect(page.locator(SVG).locator("title", { hasText: "Reused heat (HEX_Cond_Q" })).toHaveCount(3);
  // one KPI clicked: only its variables marked (PUE: the IT and the cooling power, not the reused heat)
  await kpis.getByRole("button", { name: "PUE", exact: true }).click();
  await expect(page.locator(SVG).locator("title", { hasText: "Reused heat (HEX_Cond_Q" })).toHaveCount(0);
  await expect(page.locator(SVG).locator("title", { hasText: "Cooling power · PUE" })).toHaveCount(1);
  await kpis.getByRole("button", { name: "What ERE means" }).click();
  await expect(kpis.getByRole("note")).toContainText("Energy Reuse Effectiveness");
  await button.click();
  await expect(kpis).toHaveCount(0);
  await expect(page.locator(SVG).locator("title", { hasText: "IT power · PUE" })).toHaveCount(0);
});

test("one variable dropped on another: a menu, = the same or their mean, sum, min or max", async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_blank"));
  await page.reload();
  await expect(page.locator(`${SVG} g[aria-label="Data center"]`)).toBeVisible();
  await unlock(page);
  const dragOnto = async (v: string, onto: string) => {
    const a = (await instrument(page, v).boundingBox())!;
    const b = (await instrument(page, onto).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  // Cancel puts it back
  const at = await instrument(page, "T_outdoor").getAttribute("cx");
  await dragOnto("T_outdoor", "humidity");
  const menu = page.getByRole("menu", { name: "T_outdoor on humidity" });
  await expect(menu.getByRole("menuitem", { name: "= the same" })).toBeDisabled(); // both have data
  await menu.getByRole("menuitem", { name: "Cancel" }).click();
  await expect(menu).toHaveCount(0);
  await expect(instrument(page, "T_outdoor")).toHaveAttribute("cx", at!);
  // their mean: a group of both, the two hidden
  await dragOnto("T_outdoor", "humidity");
  await page.getByRole("menu", { name: "T_outdoor on humidity" }).getByRole("menuitem", { name: "mean of both" }).click();
  await expect(page.locator(SVG).getByText("mean of 2")).toBeVisible();
  await expect(instrument(page, "T_outdoor")).toHaveCount(0);
  // "=": a variable without data dropped on one with data becomes it
  await page.getByRole("button", { name: "+ Variable" }).click();
  await page.getByLabel("Variable name").fill("Server_util");
  await page.getByLabel("Variable name").press("Enter");
  await expect(instrument(page, "Server_util")).toBeVisible();
  await page.getByRole("complementary", { name: "Selection" }).getByRole("button", { name: "Close" }).click(); // it opens over the new one
  await dragOnto("Server_util", "IT_load");
  await page.getByRole("menu", { name: "Server_util on IT_load" }).getByRole("menuitem", { name: "= the same" }).click();
  await expect(instrument(page, "Server_util")).toHaveCount(0);
  await expect(instrument(page, "IT_load")).toHaveCount(1);
  await expect(page.getByText("IT_load is Server_util now")).toBeVisible();
});

test("the framed examples: their own P&ID inside the data center's box, their variables on its margins", async ({ context, page }) => {
  for (const [ds, inside] of [
    ["sim_box_air", "CRAH"],
    ["sim_box_water", "CDU"],
  ]) {
    await context.addInitScript((d) => localStorage.setItem("dataset", d), ds);
    await page.goto("/#/dc/pid");
    await page.reload();
    await expect(page.locator(`${SVG} g[aria-label="Data center"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(SVG).getByText(inside, { exact: true })).toBeVisible(); // the drawing, inside the box
    // the margins' variables are the example's own columns, in one row over the box where no layout is saved (sim_box_air
    // keeps the user's saved one, IT_Load and ITE_Ener moved into the box)
    for (const v of ["Out_Temp", "Out_Wind", "IT_Load", "ITE_Ener", "HVAC_Ener"]) await expect(instrument(page, v)).toHaveCount(1);
    if (ds === "sim_box_water") {
      const ys = await Promise.all(["Out_Temp", "Out_Wind", "IT_Load", "ITE_Ener", "HVAC_Ener"].map((v) => instrument(page, v).getAttribute("cy")));
      expect(new Set(ys).size).toBe(1);
    }
    await expect(page.locator(SVG).getByText("heat out", { exact: true })).toBeVisible(); // the heat distribution on the right margin
  }
});

test("Structure opens to view: the drawing, the slider and the variables; Edit brings the tools that change it, Done editing hides them again", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => localStorage.setItem("dc-structure-edit", "0")); // after the beforeEach's: it wins
  await page.reload();
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible({ timeout: 30_000 });
  for (const name of ["+ Variable", "+ Add link", "Save as…", "Import P&ID…", "Edit construct"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Variables" })).toBeVisible(); // which variables are drawn: in both modes
  await edit.click();
  for (const name of ["+ Variable", "+ Add link", "Save as…", "Import P&ID…", "Edit construct"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done editing" }).click();
  await expect(page.getByRole("button", { name: "+ Add link", exact: true })).toHaveCount(0);
});
