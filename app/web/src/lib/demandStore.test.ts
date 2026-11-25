/** saveDemand: what each heat sink and the whole district write back into site.json (API mocked, nothing saved). */
import { beforeEach, expect, test, vi } from "vitest";
import type { Site } from "../api";
import { DEFAULT_DISTRICT, WHOLE } from "./demand";
import { saveDemand } from "./demandStore";

const api = vi.hoisted(() => {
  const m = { fetchSite: vi.fn(), saveSite: vi.fn(async (_id: string, s: unknown) => s) };
  // the real read-modify-write of api/site.ts, on the mocked fetch and save
  return { ...m, updateSite: async (id: string, fn: (s: unknown) => unknown) => m.saveSite(id, fn(await m.fetchSite(id))) };
});
vi.mock("../api", () => api);
vi.mock("../dataset", () => ({ DATASET: "test" }));

const sink = (id: string) => ({ id, name: id, lat: 0, lon: 0, temp_c: 50, power_kw: 77 });
beforeEach(() => api.saveSite.mockClear());

test("sinks get their settings, supply as temperature and the rounded peak as power; others stay", async () => {
  api.fetchSite.mockResolvedValue({ building: null, source: null, sinks: [sink("a"), sink("b"), sink("c")], district: { houses: 9 } } satisfies Site);
  const settings = { ...DEFAULT_DISTRICT, supplyTemp: 80 };
  const out = await saveDemand(
    [
      { id: "a", name: "a", area: false, settings },
      { id: "b", name: "b", area: false, settings },
    ],
    { a: 123.6 },
  );
  const [a, b, c] = out.sinks;
  expect([a.temp_c, a.power_kw, a.demand]).toEqual([80, 124, settings]);
  expect([b.temp_c, b.power_kw]).toEqual([80, 77]); // no peak known: keeps its power
  expect(c).toEqual(sink("c"));
  expect(out.district).toEqual({ houses: 9 });
  expect(api.saveSite).toHaveBeenCalledWith("test", out);
});

test("the whole-district entry writes site.district; the outdoor choice is kept unless given", async () => {
  api.fetchSite.mockResolvedValue({ building: null, source: null, sinks: [], outdoor: "synthetic" } satisfies Site);
  const settings = { ...DEFAULT_DISTRICT, houses: 3 };
  const out = await saveDemand([{ id: WHOLE, name: "Whole district", area: true, settings }], {});
  expect(out.district).toEqual(settings);
  expect(out.outdoor).toBe("synthetic");
  expect((await saveDemand([], {}, "open-meteo")).outdoor).toBe("open-meteo");
});
