/**
 * Components (the presets) as the heat distribution's plant models: picked under its Structure and Modelling, run by
 * Heat Matching's Model, on sim_1_modified. Read-only: saving the site is mocked here (readonly.ts aborts every other write).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7611 npx playwright test e2e/components.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("dataset", "sim_1_modified"));
  await readOnly(context);
});

test("a plant model picked under the heat distribution's Structure and Modelling runs on Heat Matching", async ({ page }) => {
  test.setTimeout(120_000);
  let site: Record<string, unknown> | null = null; // the last save, given back on the next read (nothing is written)
  await page.route("**/api/datasets/sim_1_modified/site", async (r) => {
    if (r.request().method() === "PUT") {
      site = r.request().postDataJSON();
      return r.fulfill({ json: site });
    }
    if (!site) return r.fallback();
    return r.fulfill({ json: site });
  });
  await page.goto("/#/heat/structure");
  const below = page.locator(".pid-below");
  await below.scrollIntoViewIfNeeded();
  const ports = page.getByRole("region", { name: "Connection points" });
  await expect(ports).toBeVisible({ timeout: 60_000 });
  await ports.getByRole("combobox", { name: "Heat pump model" }).selectOption("hp_2mw");
  await expect.poll(() => (site?.heat_components as Record<string, string> | undefined)?.hp).toBe("hp_2mw");

  await page.goto("/#/twin/matching");
  await expect(page.getByRole("group", { name: /Heat flow from the data center/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("radiogroup", { name: "Heat distribution source" }).getByRole("radio", { name: "Model" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.locator(".heat-cards section.card", { hasText: "Heat distribution" }).locator("summary", { hasText: "More options" }).click();
  await expect(page.getByText(/Heat pump: Heat pump 2 MW/)).toBeVisible();
  // the Calculation: the built-in formula with its own capacity
  await page.getByRole("radiogroup", { name: "Heat distribution source" }).getByRole("radio", { name: "Calculation" }).click();
  await expect(page.getByRole("group", { name: /Heat flow from the data center/ })).toContainText("max 150 kW");
});
