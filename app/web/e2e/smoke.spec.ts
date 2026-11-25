/**
 * Every page renders for the sim_1_modified dataset with no console error, no page error and no HTTP >= 500,
 * plus regression checks of shell bugs. Read-only: nothing is saved, trained or opened.
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npm run e2e`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

const ROUTES: [string, string, string, string][] = [
  // route, section tab (or "" for home and help), sub-tab label (or "" for home: no sub-tabs), text the page shows once it has rendered
  ["home/start", "", "", "Intelligent Digital Twin"],
  ["twin/map", "", "Concept", "Site"], // the whole twin's overview (old: #/district/map)
  ["district/dashboard", "District", "Visualization and Scenarios", "Visualization and Scenarios"],
  ["district/structure", "District", "Structure and Modelling", "District · Structure and Modelling"],
  ["heat/dashboard", "Heat Distribution", "Visualization and Scenarios", "Visualization and Scenarios"],
  ["heat/structure", "Heat Distribution", "Structure and Modelling", "Heat distribution · Structure and Modelling"],
  ["twin/matching", "", "Planning", "Heat Matching"], // the whole twin: the brand's button, no tab
  ["twin/planning", "", "Operation", "Operation"],
  ["dc/dashboard", "Data Center", "Visualization and Scenarios", "Visualization and Scenarios"],
  ["dc/pid", "Data Center", "Structure and Modelling", "Structure and Modelling"],
  ["help/about", "", "What is this?", "What is this?"],
  ["help/guide", "", "How to use", "How to use"],
  ["help/assistant", "", "AI assistant", "Connect a model"],
];

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

for (const [route, tab, sub, heading] of ROUTES) {
  test(`#/${route} renders cleanly`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));

    await page.goto(`/#/${route}`);
    if (tab) await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    if (sub) await expect(page.getByRole("button", { name: sub, exact: true })).toHaveAttribute("aria-current", "page");
    const main = page.locator("main.app__page");
    await expect(main.getByText(heading, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(main.getByText("This page could not be shown.")).toHaveCount(0);
    // let the first data requests answer, but do not wait for slow ones (the Modelling under a structure loads once scrolled to)
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    expect(problems).toEqual([]);
    // the document itself never scrolls, only main does (regression: .sr-only text in a page stretched the document
    // until .app__page got position: relative)
    const [docHeight, viewHeight] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(docHeight).toBeLessThanOrEqual(viewHeight + 1);
  });
}

test("no hash and an unknown hash open the Home page, with no sub-tabs", async ({ page }) => {
  for (const at of ["/", "/#/nope"]) {
    await page.goto(at);
    await expect(page.getByRole("heading", { name: "Intelligent Digital Twin", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".subtabs")).toHaveCount(0);
  }
});

test("bare #/dc opens the Data Center's first page", async ({ page }) => {
  await page.goto("/#/dc");
  await expect(page.getByRole("button", { name: "Visualization and Scenarios", exact: true })).toHaveAttribute("aria-current", "page");
});

test("a theme change rebuilds the charts (canvas colours follow the theme)", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const chart = page.locator(".uplot").first();
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await chart.evaluate((el) => el.setAttribute("data-old", "1"));
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator(".uplot[data-old]")).toHaveCount(0);
  await expect(page.locator(".uplot").first()).toBeVisible();
});

test("replay playback moves the charts without rebuilding them", async ({ page }) => {
  await page.goto("/#/dc/scenarios");
  const chart = page.locator(".uplot").first();
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {}); // the window size and what-if model settle after the data
  await page.waitForTimeout(500);
  await chart.evaluate((el) => el.setAttribute("data-old", "1"));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".uplot[data-old]")).toHaveCount(1);
});

test("the P&ID import dialog takes focus and closes on Escape", async ({ page }) => {
  await page.goto("/#/dc/pid");
  await page.getByRole("button", { name: "Edit", exact: true }).click(); // the tools that change the structure: in edit mode
  await page.getByRole("button", { name: /Import P&ID/ }).click();
  const dialog = page.getByRole("dialog", { name: "Import a P&ID" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose PDF, SVG or DEXPI…" })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); // focus stays inside the dialog
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a page whose file is gone (a tab opened before an update) reloads once instead of showing an error", async ({ page }) => {
  let missing = 1;
  await page.route(/\/assets\/SitePage-[^/]+\.js$/, (r) => (missing-- > 0 ? r.fulfill({ status: 404, body: "" }) : r.fallback()));
  await page.goto("/#/district/map");
  await expect(page.locator("main.app__page").getByText("Site", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This page could not be shown.")).toHaveCount(0);
  expect(missing).toBeLessThan(0); // the file was asked for again after the reload
});
