/**
 * The HTTP API as the page and other tools see it: the OpenAPI reference at /api/docs is complete and
 * renders, and the read-only endpoints the frontend uses answer with their documented shapes.
 * Read-only: only GET requests (nothing is saved, trained or uploaded).
 * Run against a running app: `E2E_BASE_URL=http://localhost:7600 npx playwright test e2e/api.spec.ts`.
 */
import { expect, test } from "@playwright/test";
import { readOnly } from "./readonly";

const DATASET = "sim_1_modified";
const API = `/api/datasets/${DATASET}`;

test.beforeEach(({ context }) => readOnly(context));

test("every operation in the OpenAPI schema has a summary, a description and a tag", async ({ request }) => {
  const spec = await (await request.get("/api/openapi.json")).json();
  const missing: string[] = [];
  for (const [path, ops] of Object.entries(spec.paths as Record<string, Record<string, Record<string, unknown>>>)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!op.summary || !op.description || !(op.tags as string[] | undefined)?.length) missing.push(`${method} ${path}`);
    }
  }
  expect(missing).toEqual([]);
  expect(spec.paths).toHaveProperty(["/api/datasets/{dataset_id}/models/train"]);
});

test("the API reference renders with its sections and route summaries", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto("/api/docs");
  await expect(page.getByRole("heading", { name: /Intelligent Digital Twin/ })).toBeVisible({ timeout: 30_000 });
  for (const tag of ["datasets", "graphs", "training", "site", "project", "pid"]) {
    await expect(page.locator(`#operations-tag-${tag}`)).toBeVisible();
  }
  await expect(page.getByText("Train a model", { exact: true })).toBeVisible();
  // open one operation: its parameters and their descriptions show (read-only, nothing is executed)
  await page.getByText("Get time series", { exact: true }).click();
  await expect(page.getByText("Time series of some columns", { exact: false })).toBeVisible();
  expect(problems).toEqual([]);
});

test("read-only endpoints answer with their documented shapes", async ({ request }) => {
  const health = await (await request.get("/health")).json();
  expect(health.status).toBe("ok");

  const { datasets } = await (await request.get("/api/datasets")).json();
  const sim = datasets.find((d: { id: string }) => d.id === DATASET);
  expect(sim).toBeTruthy();
  expect(Object.keys(sim).sort()).toEqual(["columns", "config", "files", "id", "name", "resolution_seconds", "row_count", "time_range"]);

  const column = sim.columns[0] as string;
  const data = await (await request.get(`${API}/data?columns=${encodeURIComponent(column)}`)).json();
  expect(data.count).toBe(data.time.length);
  expect(data.columns[column]).toHaveLength(data.count);

  const files = await (await request.get(`${API}/graph/files`)).json();
  expect(files.files).toContain("causal_graph.json");
  expect(files.files).not.toContain("pid_plant.json");
  const graph = await (await request.get(`${API}/graph`)).json();
  expect(graph.source).toBe("causal_graph.json");

  const { models } = await (await request.get(`${API}/models`)).json();
  expect(Array.isArray(models)).toBe(true);
  if (models.length) {
    const model = await (await request.get(`${API}/models/${models[0]}`)).json();
    expect(Object.keys(model).some((k) => k.startsWith("_"))).toBe(false);
  }

  for (const path of ["site", "equations", "pid/plant", "graph/drivers"]) {
    expect((await request.get(`${API}/${path}`)).status(), path).toBe(200);
  }
});

test("bad input answers with a clear 4xx, never a 500", async ({ request }) => {
  const nope = await request.get("/api/datasets/nope/site");
  expect(nope.status()).toBe(404);
  expect((await nope.json()).detail).toBe("Dataset 'nope' not found");
  expect((await request.get(`${API}/data?columns=nope`)).status()).toBe(400);
  expect((await request.get(`${API}/data?file=../x`)).status()).toBe(404);
  expect((await request.get(`${API}/graph?source=../site.json`)).status()).toBe(400);
  expect((await request.get(`${API}/models/no_such_model`)).status()).toBe(404);
});
