/** Theme helpers, and index.html's pre-paint script using the same storage keys and default palette. */
import { afterEach, expect, test, vi } from "vitest";
import indexHtml from "../../index.html?raw";
import { currentTheme, otherTheme, PALETTE_KEY, PALETTES, THEME_KEY } from "./theme";

afterEach(() => vi.unstubAllGlobals());

test("the toggle switches between light and dark", () => {
  expect(otherTheme("light")).toBe("dark");
  expect(otherTheme("dark")).toBe("light");
});

test("the theme is read from <html data-theme>; anything but dark is light", () => {
  const dataset: Record<string, string> = {};
  vi.stubGlobal("document", { documentElement: { dataset } });
  expect(currentTheme()).toBe("light");
  dataset.theme = "dark";
  expect(currentTheme()).toBe("dark");
  dataset.theme = "sepia";
  expect(currentTheme()).toBe("light");
});

test("three palettes, aurora first (the default)", () => {
  expect(PALETTES.map((p) => p.id)).toEqual(["aurora", "electric", "emerald"]);
});

test("index.html applies the saved theme and palette with the same keys and default", () => {
  expect(indexHtml).toContain(`localStorage.getItem("${THEME_KEY}")`);
  expect(indexHtml).toContain(`localStorage.getItem("${PALETTE_KEY}") || "${PALETTES[0].id}"`);
});
