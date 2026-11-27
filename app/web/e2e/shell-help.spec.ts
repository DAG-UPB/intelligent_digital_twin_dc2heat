/**
 * The app shell, the Home page and the help pages: the one-row header, home and help navigation, theme and language, the compact tools.
 * Read-only: Save project / Open project and the data center menu are checked but never used.
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/shell-help.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

for (const width of [1280, 1440, 1920]) {
  test(`at ${width} px the header is one row, the section tabs clear of the tools`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/#/help/about");
    await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible();
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const [bar, brand, tabs, tools] = [await box(".topbar"), await box(".topbar__brand"), await box(".topbar__tabs"), await box(".topbar__tools")];
    const fit = await page.evaluate(() => Number(document.documentElement.style.zoom) || 1); // the app scaled to the window (main.tsx)
    expect(bar.height / fit).toBeLessThan(80); // one row (two rows are > 90 px)
    await expect(page.locator(".topbar__brand").getByRole("link", { name: "Home" })).toBeVisible(); // the house button, right of the logo
    await expect(page.locator(".topbar__brand img")).toHaveAttribute("title", /version \d+\.\d+\.\d+$/); // the logo's tooltip: name and version
    if (width / fit >= 1920) expect(Math.abs(tabs.x + tabs.width / 2 - width / 2)).toBeLessThanOrEqual(1); // centred where there is room; narrower, the tools keep theirs
    const tool = (await page.locator(".topbar__tools > *").first().boundingBox())!;
    expect(tabs.x + tabs.width).toBeLessThan(tool.x); // the tabs never run under the tools
    expect(brand.x + brand.width).toBeLessThan(tabs.x);
    expect(tabs.x + tabs.width).toBeLessThan(tools.x);
    expect(tools.x + tools.width).toBeLessThanOrEqual(width);
  });
}

test("the tools are named for screen readers and the menu shows the full name as a tooltip", async ({ page }) => {
  await page.goto("/#/district/map");
  await expect(page.getByRole("button", { name: "Save project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project" })).toBeVisible();
  await page.locator(".subtabs__systems > summary").click(); // the case's three systems, under one button
  await expect(page.getByRole("combobox", { name: "Data center" })).toHaveAttribute("title", / › Simulation 1/);
});

test("help: ? says what the page is for and leads to What is this?, then How to use, whose steps lead to the pages", async ({ page }) => {
  await page.goto("/#/district/map");
  await page.getByRole("button", { name: "Help" }).click();
  const box = page.getByRole("dialog", { name: "Help on this page" });
  await expect(box).toContainText("on a map"); // the Site map's line (home.ts)
  await box.getByRole("link", { name: "What is this?" }).click();
  await expect(page).toHaveURL(/#\/help\/about$/);
  await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible();
  await expect(box).toHaveCount(0);
  for (const docs of await page.locator('a[href="/docs/"]').all()) await expect(docs).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "How to use", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How to use", level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Intelligent Digital Twin: does it match/ }).click();
  await expect(page.locator("#step-9")).toBeInViewport();

  await page.getByRole("link", { name: "Go to Structure and Modelling" }).first().click();
  await expect(page).toHaveURL(/#\/dc\/pid$/);
  await expect(page.getByRole("tab", { name: "Data Center" })).toHaveAttribute("aria-selected", "true");
});

test("Home: the house button opens it; its cards lead to the pages and the links open in a new tab", async ({ page }) => {
  await page.goto("/#/dc/pid");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/#\/home\/start$/);
  await expect(page.getByRole("heading", { name: "Intelligent Digital Twin", level: 1 })).toBeVisible();
  const main = page.locator("main.app__page");
  for (const href of ["https://dc2heat.de/", "/docs/", "/api/docs"]) {
    await expect(main.locator(`a[href="${href}"]`)).toHaveAttribute("target", "_blank");
    await expect(main.locator(`a[href="${href}"]`)).toHaveAttribute("rel", "noreferrer");
  }
  await expect(main.getByRole("link", { name: /^Go to / })).toHaveCount(9); // one card per section page
  await main.locator('a[href="#/district/structure"]').click();
  await expect(page).toHaveURL(/#\/district\/structure$/);
  await expect(page.getByRole("tab", { name: "District" })).toHaveAttribute("aria-selected", "true");
});

test("a fresh browser opens blank; Home's Start with the example loads Case 1 on the Site map, a new tab blank again", async ({ page, context }) => {
  await page.addInitScript(() => localStorage.clear()); // after beforeEach's: nothing remembered
  await page.goto("/#/twin/map"); // the Case menu is beside a page's tabs, not on Home
  await expect(page.getByRole("combobox", { name: "Case" })).toHaveValue("Blank · start from scratch");
  await page.goto("/");
  await page.locator("main.app__page").getByRole("link", { name: "Start with the example" }).click();
  await expect(page).toHaveURL(/\/#\/twin\/map$/);
  await expect(page.getByRole("combobox", { name: "Case" })).toHaveValue("Case 1 · Recovery, trained models");
  await page.reload(); // a reload keeps it
  await expect(page.getByRole("combobox", { name: "Case" })).toHaveValue("Case 1 · Recovery, trained models");
  const tab = await context.newPage(); // the app opened again: blank
  await tab.goto("/#/twin/map");
  await expect(tab.getByRole("combobox", { name: "Case" })).toHaveValue("Blank · start from scratch");
});

test("theme toggle restyles the app; one palette, the language button beside it", async ({ page }) => {
  await page.goto("/#/help/about");
  const html = page.locator("html");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-palette", "aurora");
  await expect(page.getByRole("radiogroup", { name: "Color palette" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Language/ })).toBeVisible();
});

test("a page that fails to load shows an error box and leaves the rest of the app working", async ({ page }) => {
  // dev server: modules are served from /src; built app: lazy chunks under /assets
  await page.route(/\/(src\/pages\/help\/GuidePage\.tsx|assets\/GuidePage[^/]*\.js)/, (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/#/help/guide");
  await expect(page.getByText("This page could not be shown.")).toBeVisible();
  await page.getByRole("button", { name: "What is this?", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible();
});

test("the whole twin's button, beside the three parts it is made of, opens its site map", async ({ page }) => {
  await page.goto("/#/dc/dashboard");
  const twin = page.getByRole("button", { name: "Intelligent Digital Twin" });
  await expect(page.getByRole("tab", { name: "Intelligent Digital Twin" })).toHaveCount(0); // not a tab beside the parts
  await expect(page.getByLabel("Parts of the twin").getByRole("tab")).toHaveText([/Data Center/, /Heat Distribution/, /District/]);
  await twin.click();
  await expect(page).toHaveURL(/#\/twin\/map$/);
  await expect(twin).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Operation", exact: true })).toBeVisible();
});
