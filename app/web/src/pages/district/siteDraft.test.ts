import { beforeEach, expect, test, vi } from "vitest";
import type { Site } from "../../api";
import { draftOf, dropDraft, keepDraft, resetBrowser } from "./siteDraft";

beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  });
});

test("a draft is kept per data center until it is dropped (saved)", () => {
  const site: Site = { building: null, source: null, sinks: [{ id: "s", name: "s", lat: 50.1, lon: 8.7, temp_c: 70, power_kw: 10 }] };
  keepDraft("sim_blank", site);
  expect(draftOf("sim_blank")).toEqual(site);
  expect(draftOf("sim_recovery_air")).toBeNull();
  dropDraft("sim_blank");
  expect(draftOf("sim_blank")).toBeNull();
});

test("the bin's reset forgets the drafts, Heat Matching's year and the picks; the user's cases and theme stay", () => {
  for (const k of ["site-draft:a", "site-draft:b", "heat-matching", "case", "dataset", "dataset:twin/map", "cases", "theme", "palette"]) localStorage.setItem(k, "x");
  expect(resetBrowser().sort()).toEqual(["case", "dataset", "dataset:twin/map", "heat-matching", "site-draft:a", "site-draft:b"]);
  expect(["cases", "theme", "palette"].map((k) => localStorage.getItem(k))).toEqual(["x", "x", "x"]);
});
