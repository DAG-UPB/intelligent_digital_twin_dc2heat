/**
 * The causal graph on the left (GraphSidebar), the same module on Visualization and Scenarios and under Structure and
 * Modelling: dragged wider it draws a bigger graph, dragged far to the left it closes, its tab opens it again.
 * Read-only. Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/graph-side.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

test("drag the line beside the graph: wider, then far left to close it; the tab opens it again", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const panel = page.getByRole("complementary", { name: "Causal graph panel" });
  const handle = page.getByRole("separator", { name: "Causal graph width" });
  await expect(panel.getByRole("group", { name: "Causal graph" })).toBeVisible({ timeout: 30_000 });
  const before = (await panel.boundingBox())!.width;
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 100);
  await page.mouse.down();
  await page.mouse.move(h.x + 150, h.y + 100, { steps: 5 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(before + 100);
  const h2 = (await handle.boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + 100);
  await page.mouse.down();
  await page.mouse.move(40, h2.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Show the causal graph" }).click();
  await expect(panel.getByRole("group", { name: "Causal graph" })).toBeVisible();
});

test("the same panel under Structure and Modelling: a variable picked in it is selected on the drawing above", async ({ page }) => {
  await page.goto("/#/heat/structure");
  const below = page.getByRole("region", { name: "Modelling" });
  await below.scrollIntoViewIfNeeded();
  const panel = below.getByRole("complementary", { name: "Causal graph panel" });
  await expect(panel.getByRole("group", { name: "Causal graph" })).toBeVisible({ timeout: 30_000 });
  await expect(below.getByRole("separator", { name: "Causal graph width" })).toBeVisible();
  await panel.getByRole("button", { name: "COP", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside.pid-side")).toContainText("COP");
});

test("a variable picked in the graph is shown on the right: added to the time series (a double click: only it), chosen in the views, marked in the tables", async ({
  page,
}) => {
  await page.goto("/#/dc/dashboard");
  const panel = page.getByRole("complementary", { name: "Causal graph panel" });
  await expect(panel.getByRole("group", { name: "Causal graph" })).toBeVisible({ timeout: 30_000 });
  // the graph's own node: the Variables to plot chips sit in the same panel, under the graph
  const node = panel.getByRole("group", { name: "Causal graph" }).getByRole("button", { name: "Out_Temp", exact: true });
  await node.focus();
  await page.keyboard.press("Enter");
  const plot = panel.getByRole("group", { name: "Variables to plot" });
  await expect(plot.getByRole("button", { name: "Out_Temp", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(plot.getByRole("button", { name: "In_Temp", exact: true })).toHaveAttribute("aria-pressed", "true"); // added, not alone
  await node.dblclick();
  await expect(plot.getByRole("button", { name: "In_Temp", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".dash-series .uplot")).toHaveCount(1);
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Variables", exact: true }).click(); // the table, in its tab
  await expect(page.locator(".dash-table__row--focus")).toContainText("Out_Temp");
  await page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Daily profile" }).click();
  await expect(page.getByLabel("Variable", { exact: true })).toHaveValue("Out_Temp");
});
