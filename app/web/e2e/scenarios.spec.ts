/**
 * Data Center > Scenarios, read-only: replay controls, mini map picks, a what-if run, Re-prepare (intercepted, it would
 * re-train) and a short test-period simulation, for sim_1_modified. Run: `E2E_BASE_URL=http://localhost:7611 npm run e2e`.
 */
import { expect, test, type Page } from "@playwright/test";
import { readOnly } from "./readonly";

const MODEL_URL = "/api/datasets/sim_1_modified/models/linear";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

async function open(page: Page, problems: string[]) {
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto("/#/dc/scenarios");
  await expect(page.locator(".uplot").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

const node = (page: Page, v: string) => page.getByRole("group", { name: "Causal graph" }).getByRole("button", { name: v, exact: true });

test("replay controls move the playhead, cycle the speed and change the window", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  const time = page.locator(".replay__time");
  const first = await time.innerText();
  await page.getByRole("button", { name: "Step forward" }).click();
  await expect(time).not.toHaveText(first);
  await page.getByRole("button", { name: "Step back" }).click();
  await expect(time).toHaveText(first);

  const speed = page.getByTitle("Cycle playback speed");
  await expect(speed).toHaveText("10×");
  await speed.click();
  await expect(speed).toHaveText("60×");

  await page.getByLabel("Window").selectOption({ label: "24 h" });
  const signals = page.getByRole("group", { name: "Visualization variables" });
  const panel = page.getByRole("complementary", { name: "Causal graph panel" });
  await panel.getByRole("button", { name: "All", exact: true }).click();
  await panel.getByRole("button", { name: "None", exact: true }).click();
  await expect(page.getByText("Pick the variables to plot in the panel on the left")).toBeVisible();
  await signals.getByRole("button", { name: "In_Temp", exact: true }).click();
  await expect(page.locator(".uplot")).toHaveCount(1);
  // signals, like the map: the selected HEX's T_in, T_out and m only (no calculated Q, no other option)
  const hex = signals.getByRole("button", { name: /^HEX_/ });
  await expect(hex).toHaveCount(3);
  expect(new Set((await hex.allTextContents()).map((t) => t.split("_")[1])).size).toBe(1);
  expect(problems).toEqual([]);
});

test("the period on the left, as in Historical: a month picked, the replay shows that month", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  const panel = page.getByRole("complementary", { name: "Causal graph panel" });
  await expect(panel.getByLabel("Period")).toBeVisible();
  await panel.getByLabel("Month").selectOption({ label: "Feb" });
  await expect(page.getByLabel("Window").locator("option:checked")).toHaveText(/^(28|29) d$/);
  await expect(page.locator(".replay__time")).toContainText("-02-");
  expect(problems).toEqual([]);
});

test("a mini map pick lights its downstream and becomes an intervention in both modes", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  // one list of intervention variables, in the panel under the graph: the KPIs' levers and the what-if's
  const levers = page.getByRole("complementary", { name: "Causal graph panel" }).getByRole("group", { name: "Intervention variables" });
  await expect(page.getByRole("group", { name: "Intervention variables" })).toHaveCount(1);
  await levers.getByRole("button", { name: "Cool_Set" }).click(); // the first lever, on at the start: off
  await expect(levers.getByRole("button", { name: "Cool_Set" })).toHaveAttribute("aria-pressed", "false");
  await node(page, "Cool_Set").click();
  await expect(page.locator(".minimap__info")).toContainText("affects");
  await expect(levers.getByRole("button", { name: "Cool_Set" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("leave empty for ground truth")).toHaveCount(1); // the what-if takes it

  await page.getByRole("tab", { name: "Long period simulation" }).click();
  await expect(page.getByRole("group", { name: "Intervention 1" }).getByLabel("Variable")).toHaveValue("Cool_Set");
  // switching back keeps the step-through state (both modes stay mounted)
  await page.getByRole("tab", { name: "Step-through (replay)" }).click();
  await expect(page.getByLabel("Window")).toBeVisible();
  expect(problems).toEqual([]);
});

test("a what-if run shows its prediction step by step", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  await expect(page.getByRole("group", { name: "Intervention variables" }).getByRole("button", { name: "Cool_Set" })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("leave empty for ground truth").fill("20");
  await page.getByRole("button", { name: "Run What-If" }).click();
  await expect(page.getByRole("button", { name: "Exit What-If" })).toBeVisible({ timeout: 30_000 });
  const forward = page.getByRole("button", { name: "Step Forward", exact: true });
  await forward.click();
  await forward.click();
  await expect(page.getByText("2 / 20")).toBeVisible();
  await expect(page.getByText("PREDICTION", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Exit What-If" }).click();
  await expect(page.getByRole("button", { name: "Run What-If" })).toBeVisible();
  // the setup is kept for the next run
  await expect(page.getByPlaceholder("leave empty for ground truth")).toHaveValue("20");
  expect(problems).toEqual([]);
});

test("each run shows its KPIs from the KPI variables: measured, the twin without and with the change", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  await expect(page.getByRole("group", { name: "Intervention variables" }).getByRole("button", { name: "Cool_Set" })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("leave empty for ground truth").fill("20");
  await page.getByRole("button", { name: "Run What-If" }).click();
  const kpis = page.getByRole("table", { name: "KPIs: measured and the twin's" }).first();
  await expect(kpis).toBeVisible({ timeout: 30_000 });
  await expect(kpis.getByRole("columnheader", { name: "Twin, your overrides" })).toBeVisible();
  await expect(kpis.getByRole("rowheader", { name: "PUE (partial)" })).toBeVisible();

  // the long period simulation without an intervention: measured against the twin, no change column
  await page.getByRole("tab", { name: "Long period simulation" }).click();
  await page.getByLabel("Horizon", { exact: true }).selectOption({ label: "7 d" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const year = page.locator(".test-period").getByRole("table", { name: "KPIs: measured and the twin's" });
  await expect(year.getByRole("rowheader", { name: "ERF" })).toBeVisible({ timeout: 60_000 });
  await expect(year.getByRole("columnheader", { name: "Change" })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("Re-prepare re-sends the saved model's training settings (request intercepted, nothing re-trained)", async ({ page, request }) => {
  const saved = await (await request.get(MODEL_URL)).json();
  let body: Record<string, unknown> | null = null;
  await page.route("**/models/train", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: saved });
  });
  const problems: string[] = [];
  await open(page, problems);
  await page.getByRole("button", { name: "Re-prepare" }).click();
  await expect.poll(() => body).not.toBeNull();
  expect(body).toMatchObject({
    name: "linear",
    file: saved.file,
    split_fraction: Math.round((saved.split_index / saved.rows) * 100) / 100,
    graph_file: saved.graph_file,
    drivers: saved.requested_drivers ?? saved.drivers,
    structure: saved.structure,
    max_lag: saved.max_lag_setting,
    variables: saved.variables_used,
    model: saved.kind,
  });
  expect(problems).toEqual([]);
});

test("a short test-period simulation shows a band chart with the means", async ({ page }) => {
  const problems: string[] = [];
  await open(page, problems);
  await page.getByRole("tab", { name: "Long period simulation" }).click();
  await page.getByLabel("Horizon", { exact: true }).selectOption({ label: "7 d" });
  await page.getByRole("button", { name: "+ Add intervention" }).click();
  // interventions: the selected HEX's T_in, T_out and m only; its Q is calculated, so it is plotted, not intervened on
  const options = await page.getByRole("group", { name: "Intervention 1" }).getByLabel("Variable").locator("option").allTextContents();
  const hex = options.filter((v) => v.startsWith("HEX_"));
  expect(hex).toHaveLength(3);
  expect(hex.some((v) => v.endsWith("_Q"))).toBe(false);
  const q = `HEX_${hex[0].split("_")[1]}_Q`;
  const plot = page.getByRole("group", { name: "Plot" });
  await expect(plot.getByText(/^HEX_.*_Q/)).toHaveCount(1);
  await plot.getByLabel(new RegExp(`^${q}`)).check();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/mean: actual .* change/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".test-period .uplot").first()).toBeVisible();
  await expect(page.getByRole("region", { name: q }).getByText(/mean: actual .* change/)).toBeVisible();
  expect(problems).toEqual([]);
});
