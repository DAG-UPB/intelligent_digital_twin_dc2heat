/**
 * The tours (pages/help/tours.ts): every page's tour ("?" › Explain this page) and the app's ("?" › How to get around
 * the app) walk to their end, each step on its part of the page (an optional one may be passed over); every "Show me"
 * of the tutorial opens its page with the tour at its step. Read-only (readonly.ts).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/tour.spec.ts --project=app`.
 */
import { expect, test, type Page } from "@playwright/test";
import { COMPUTE, readOnly } from "./readonly";
import { PATHS } from "../src/pages/help/paths";
import { APP_TOUR, TOURS } from "../src/pages/help/tours";
import type { TourStep } from "../src/ui/Tour";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_recovery_air"));
  await readOnly(context);
});

const card = (page: Page) => page.getByRole("dialog", { name: /^Tour: / });

/** The card all on screen, the light on the step's part (its middle inside it): the page's zoom (main.tsx) counted. */
const placed = (target: string) => {
  const c = document.querySelector(".tour__card")!.getBoundingClientRect();
  // the light: its spot, or the spots of its parts (TourStep.parts) taken together
  const spots = [...document.querySelectorAll(".tour__spot")].map((e) => e.getBoundingClientRect());
  const spot = spots.length
    ? { left: Math.min(...spots.map((r) => r.left)), top: Math.min(...spots.map((r) => r.top)), right: Math.max(...spots.map((r) => r.right)), bottom: Math.max(...spots.map((r) => r.bottom)) }
    : null;
  const t = [...document.querySelectorAll(target)].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0 && r.height > 0);
  const onScreen = c.left >= 0 && c.top >= 0 && c.right <= innerWidth + 1 && c.bottom <= innerHeight + 1;
  const mid = t && [t.left + t.width / 2, t.top + t.height / 2];
  const lit = !!(spot && mid && mid[0] >= spot.left && mid[0] <= spot.right && mid[1] >= spot.top && mid[1] <= spot.bottom);
  return onScreen && lit;
};

/** Next to the end: every step shown on its part, its card on screen; the tour saves nothing (its demos only show). */
async function walk(page: Page, what: string, steps: TourStep[]) {
  const n = steps.length;
  await expect(card(page)).toBeVisible({ timeout: 15_000 }); // started (Case 1 put on before, which may write its models)
  const writes: string[] = [];
  page.on("request", (q) => q.method() !== "GET" && q.url().includes("/api/") && !COMPUTE.test(q.url()) && writes.push(`${q.method()} ${q.url()}`));
  for (let k = 0; k <= n; k++) {
    await expect(card(page)).not.toHaveAttribute("data-found", "looking", { timeout: 15_000 });
    const at = Number(await card(page).getAttribute("data-step"));
    expect(await card(page).getAttribute("data-found"), `${what}, step ${at}`).toBe("true");
    // the light and the card glide to their place (the page still loading moves the part)
    await expect.poll(() => page.evaluate(placed, steps[at - 1].target), { message: `${what}, step ${at}: on screen, on its part`, timeout: 5000 }).toBe(true);
    const next = card(page).getByRole("button", { name: /^(Next|Done)$/ });
    const done = (await next.innerText()) === "Done";
    await next.click();
    if (done) {
      await expect(card(page)).toHaveCount(0);
      return expect(writes, `${what}: nothing saved`).toEqual([]);
    }
    await expect(card(page)).not.toHaveAttribute("data-step", String(at)); // the next step's card, not this one still
  }
  throw new Error(`${what}: no end after ${n} steps`);
}

for (const [route, steps] of Object.entries(TOURS))
  test(`#/${route}: ? › Explain this page walks its tour, every part found`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    await page.getByRole("button", { name: "Help" }).click();
    await page.getByRole("button", { name: "▶ Explain this page" }).click();
    await walk(page, route, steps);
  });

test("? › How to get around the app: the top bar and the page tabs, from any page", async ({ page }) => {
  await page.goto("/#/help/about");
  await page.getByRole("button", { name: "Help" }).click();
  const box = page.getByRole("dialog", { name: "Help on this page" });
  await expect(box.getByRole("button", { name: "▶ Explain this page" })).toHaveCount(0); // no tour of its own
  await box.getByRole("button", { name: "▶ How to get around the app" }).click();
  await expect(page).toHaveURL(/#\/home\/start$/);
  await expect(card(page)).toContainText("The system");
  await walk(page, "the app", APP_TOUR);
});

test("the tutorial: one list per path, every “Show me” opens its page with the tour at its step", async ({ page }) => {
  const steps = PATHS.flatMap((p) => p.steps.map((s) => ({ ...s, path: p.title })));
  await page.goto("/#/help/guide");
  await expect(page.getByRole("radio", { name: "Complex" })).toHaveCount(0); // no simple or complex: one list
  for (const [k, s] of steps.entries()) {
    await page.goto("/#/help/guide");
    await page.getByRole("button", { name: "▶ Show me" }).nth(k).click();
    await expect(page).toHaveURL(new RegExp(`#/${s.route}$`));
    await expect(card(page)).not.toHaveAttribute("data-found", "looking", { timeout: 15_000 });
    expect(await card(page).getAttribute("data-found"), `${s.path}: ${s.text}`).toBe("true");
    const title = TOURS[s.route].find((t) => t.title === s.at) ?? TOURS[s.route][0];
    if (!title.optional) await expect(card(page).locator(".tour__title")).toHaveText(title.title);
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
  }
});

// each step that shows something working: done on the step (on), undone when it is left (off)
const R = (group: string, n: number) => `${group} [role="radio"]:nth-child(${n})[aria-checked="true"]`;
const DEMOS: [string, string, string, string][] = [
  ["twin/map", "Day and year", '.maptime__dial--day .maptime__play[aria-pressed="true"]', '.maptime__dial--day .maptime__play[aria-pressed="false"]'],
  ["twin/matching", "Model or Calculation", R('div.segmented[data-label="Data center source"]', 2), R('div.segmented[data-label="Data center source"]', 1)],
  ["twin/matching", "Below: what if?", "details.twin-whatif[open]", "details.twin-whatif:not([open])"],
  ["twin/planning", "Three strategies", R('div.segmented[data-label="Optimise for"]', 2), R('div.segmented[data-label="Optimise for"]', 1)],
  ["dc/dashboard", "Scenarios", R(".dash__mode div.segmented", 2), R(".dash__mode div.segmented", 1)],
  ["dc/dashboard", "The visuals", R('.dash__explore div.segmented[data-label="View"]', 5), R('.dash__explore div.segmented[data-label="View"]', 1)],
  ["dc/pid", "The causal graph", '.pid-stage__stop:nth-of-type(3)[aria-pressed="true"]', '.pid-stage__stop:nth-of-type(1)[aria-pressed="true"]'],
  ["dc/pid", "The modelling", '.train-bar > button[aria-expanded="true"]', '.train-bar > button[aria-expanded="false"]'],
];
for (const [route, title, on, off] of DEMOS)
  test(`#/${route}, “${title}”: the step shows it working, and undoes it when left`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    await page.getByRole("button", { name: "Help" }).click();
    await page.getByRole("button", { name: "▶ Explain this page" }).click();
    for (let k = 0; k < 12 && (await card(page).locator(".tour__title").innerText()) !== title; k++) {
      const at = await card(page).getAttribute("data-step");
      await card(page)
        .getByRole("button", { name: /^(Next|Done)$/ })
        .click();
      await expect(card(page)).not.toHaveAttribute("data-step", at!);
    }
    await expect(card(page).locator(".tour__title")).toHaveText(title);
    await expect(page.locator(on).first()).toBeAttached({ timeout: 15_000 }); // done on the step
    await card(page)
      .getByRole("button", { name: /^(Next|Done)$/ })
      .click();
    await expect(page.locator(off).first()).toBeAttached({ timeout: 15_000 }); // undone once left
  });
