/**
 * Heat Matching with inputs from another dataset: sim_recovery_air (the data center, its own demand and
 * weather) matched against sim_district_heat (a separate simulation of a district). What if… › Weather from / Heat
 * demand from put the district's series in: the district card shows its demand, and the data center's trained model
 * (picked under the Data center card's More options) runs on its weather: its free-run request carries the district's
 * outdoor temperature (the data center's heat does not follow the demand: the loop does the matching).
 * Read-only (readonly.ts). Run against a running app: `E2E_BASE_URL=http://localhost:7612 npx playwright test e2e/matching-inputs.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_recovery_air"));
  await readOnly(context);
  await page.goto("/#/twin/matching");
  await expect(page.getByRole("group", { name: /Heat flow from the data center/ })).toBeVisible({ timeout: 60_000 });
});

test("the district's demand and weather from another dataset go into the data center's model", async ({ page }) => {
  const cards = page.locator(".heat-cards--under > .card");
  await cards.nth(0).locator("summary", { hasText: "More options" }).click();
  await page.getByLabel("Data center: model and system").selectOption("model:xgb"); // the folder next to "Model ›"
  await cards.nth(0).locator("summary", { hasText: "More options" }).click(); // closed: its panel lies over what follows
  await page.locator("summary", { hasText: "What if" }).click();

  // the run with the district's weather put in for the data center's own
  const run = page.waitForRequest((r) => r.url().includes("/models/xgb/simulate") && "Out_Temp" in (r.postDataJSON()?.drivers ?? {}));
  await page.getByLabel("Weather from").selectOption("sim_district_heat");
  await page.getByLabel("Heat demand from").selectOption("sim_district_heat");
  await page.getByRole("button", { name: "Run scenario" }).click(); // both put in at once
  const drivers = (await run).postDataJSON().drivers as Record<string, number[]>;
  expect(Object.keys(drivers)).toEqual(["Out_Temp"]); // its demand is no input of the data center's model
  expect(drivers.Out_Temp.length).toBeGreaterThan(8000); // the held-out year, hourly

  await cards.nth(2).locator("summary", { hasText: "More options" }).click();
  await expect(cards.nth(2)).toContainText("Heat_Demand of District · heat demand, as measured");
  await expect(page.locator(".heat-kpis .kpi", { hasText: "Heat delivered" })).toContainText(/of 5,\d\d GWh demand/, { timeout: 30_000 });
});
