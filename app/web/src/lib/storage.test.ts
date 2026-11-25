/** The browser's storage: the same texts as the pages wrote by hand (JSON, "1" / "0"), and storage that is off. */
import { afterEach, expect, test, vi } from "vitest";
import { FLAG, readJson, writeJson } from "./storage";

const m = new Map<string, string>();
afterEach(() => {
  m.clear();
  vi.unstubAllGlobals();
});
const stub = () =>
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });

test("JSON: written as JSON.stringify, read back, null removes it; missing or broken gives the fallback", () => {
  stub();
  writeJson("site-panel-pos", { x: 3, y: 4 });
  expect(m.get("site-panel-pos")).toBe('{"x":3,"y":4}');
  expect(readJson("site-panel-pos", {})).toEqual({ x: 3, y: 4 });
  writeJson("site-panel-pos", null);
  expect(m.has("site-panel-pos")).toBe(false);
  expect(readJson("site-panel-pos", { x: 0 })).toEqual({ x: 0 });
  m.set("site-network", "{broken");
  expect(readJson("site-network", "fallback")).toBe("fallback");
  m.set("site-network", "");
  expect(readJson("site-network", "fallback")).toBe("fallback");
});

test('FLAG: "1" / "0", missing gives the initial', () => {
  stub();
  expect(readJson("site-card-sink", true, FLAG)).toBe(true);
  writeJson("site-card-sink", false, FLAG);
  expect(m.get("site-card-sink")).toBe("0");
  expect(readJson("site-card-sink", true, FLAG)).toBe(false);
  writeJson("site-card-sink", true, FLAG);
  expect(m.get("site-card-sink")).toBe("1");
  expect(readJson("site-card-sink", false, FLAG)).toBe(true);
});

test("storage off: reads give the fallback, writes do nothing", () => {
  const off = () => {
    throw new Error("SecurityError");
  };
  vi.stubGlobal("localStorage", { getItem: off, setItem: off, removeItem: off });
  expect(readJson("x", 5)).toBe(5);
  expect(() => writeJson("x", 1)).not.toThrow();
  expect(() => writeJson("x", null)).not.toThrow();
});
