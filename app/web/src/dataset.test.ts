/** The active dataset (remembered in localStorage) and datasetConfig: one fetch, but a failed fetch is not remembered. */
import { afterEach, expect, test, vi } from "vitest";
import { configOf, DATASET, datasetConfig } from "./dataset";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A fresh copy of dataset.ts, evaluated with this localStorage. */
async function load(storage: Partial<Storage>) {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  return import("./dataset");
}

test("DATASET is the remembered one, else the default (also when storage is blocked)", async () => {
  expect((await load({ getItem: () => "plant_b_1" })).DATASET).toBe("plant_b_1");
  expect((await load({ getItem: () => null })).DATASET).toBe("sim_recovery_air");
  const blocked = () => {
    throw new Error("SecurityError");
  };
  expect((await load({ getItem: blocked })).DATASET).toBe("sim_recovery_air");
});

test("switchDataset remembers the choice and reloads, even when storage is blocked", async () => {
  const setItem = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload, hash: "#/dc/pid" } });
  (await load({ getItem: () => null, setItem })).switchDataset("minidc_exp_1");
  expect(setItem).toHaveBeenCalledWith("dataset", "minidc_exp_1");
  expect(setItem).toHaveBeenCalledWith("dataset:dc/pid", "minidc_exp_1"); // the page on screen opens on it
  const blocked = () => {
    throw new Error("SecurityError");
  };
  (await load({ getItem: blocked, setItem: blocked })).switchDataset("x");
  expect(reload).toHaveBeenCalledTimes(2);
});

test("each page has its own dataset: its choice, else the last one chosen, else the default", async () => {
  const store: Record<string, string> = {};
  const m = await load({ getItem: (k) => store[k] ?? null, setItem: (k, v) => void (store[k] = v) });
  expect(m.datasetOf("dc/pid")).toBe("sim_recovery_air");
  m.chooseDataset("dc/pid", "minidc_exp_1");
  expect(m.datasetOf("dc/pid")).toBe("minidc_exp_1");
  expect(m.datasetOf("twin/map")).toBe("minidc_exp_1"); // a page without a choice opens on the last one
  m.chooseDataset("twin/map", "sim_2");
  expect([m.datasetOf("dc/pid"), m.datasetOf("twin/map")]).toEqual(["minidc_exp_1", "sim_2"]);
  m.openDataset("sim_2");
  expect(m.DATASET).toBe("sim_2"); // the live binding the pages read
});

test("configOf fills the lists and keeps the rest", () => {
  expect(configOf(undefined)).toEqual({ actuators: [], heat: [], levers: [] });
  const d = { config: { name: "Sim", kind: "testbed", heat: ["Q"] } } as never;
  expect(configOf(d)).toEqual({ name: "Sim", kind: "testbed", actuators: [], heat: ["Q"], levers: [] });
});

test("a failed fetch is retried, a good one is cached", async () => {
  const ok = { datasets: [{ id: DATASET, config: { levers: ["Cool_Set"] } }] };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("down", { status: 503 }))
    .mockResolvedValue(new Response(JSON.stringify(ok)));
  vi.stubGlobal("fetch", fetch);
  await expect(datasetConfig()).rejects.toThrow("Failed to fetch datasets: down");
  expect((await datasetConfig()).levers).toEqual(["Cool_Set"]);
  await datasetConfig();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("after a data-version switch the same data center stays open if the version has it, else its first", async () => {
  const { datasetAfterSwitch } = await load({ getItem: () => null });
  expect(datasetAfterSwitch(["minidc_exp_1", "sim_1"], "sim_1")).toBe("sim_1");
  expect(datasetAfterSwitch(["minidc_exp_1", "sim_1"], "sim_9")).toBe("minidc_exp_1");
  expect(datasetAfterSwitch([], "sim_9")).toBe("sim_9");
});

test("a project opens on its own data center, not on an example every project has", async () => {
  const { projectDataset } = await load({ getItem: () => null });
  const v5 = [{ id: "sim_recovery_air", example: true }, { id: "plant_a" }];
  expect(projectDataset(v5, "sim_recovery_air")).toBe("plant_a");
  expect(projectDataset(v5, "plant_a")).toBe("plant_a");
  expect(projectDataset([{ id: "sim_1", example: true }], "sim_9")).toBe("sim_1"); // the examples: as before
});

test("a browser whose picks were made in another project opens the project's own data center, once", async () => {
  // a storage whose keys are its own fields, as the browser's (forgetPagePicks walks them)
  const ls: Record<string, unknown> = { dataset: "sim_recovery_air", "dataset:district/map": "sim_recovery_air" };
  Object.defineProperties(ls, {
    getItem: { value: (k: string) => (k in ls ? String(ls[k]) : null) },
    setItem: { value: (k: string, v: string) => void (ls[k] = v) },
    removeItem: { value: (k: string) => void delete ls[k] },
  });
  const { enterProject } = await load(ls as unknown as Storage);
  const v5 = [{ id: "sim_recovery_air", example: true }, { id: "plant_a" }];
  expect(enterProject("version_2", v5)).toBe(true);
  expect([ls.dataset, ls["dataset:district/map"]]).toEqual(["plant_a", undefined]);
  ls.dataset = "sim_recovery_air"; // an example picked later in the same project stays
  expect(enterProject("version_2", v5)).toBe(false);
});
