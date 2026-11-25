/**
 * Theme (light / dark) and colour palette, set as `data-theme` / `data-palette` on <html> and remembered
 * in localStorage. index.html applies the saved ones before the first paint with the same keys (keep both
 * places in step). The colours themselves are CSS custom properties in index.css, one block per palette x theme.
 */
import { useEffect, useState } from "react";

export const THEME_KEY = "theme";
export const PALETTE_KEY = "palette";

export type Theme = "light" | "dark";

/** Color palettes (index.css), each with a light and a dark version. */
export const PALETTES = [
  { id: "aurora", label: "Aurora", swatch: "linear-gradient(135deg, #5B4BFF, #F43F5E)" },
  { id: "electric", label: "Electric", swatch: "linear-gradient(135deg, #1F5BFF, #C6FF3D)" },
  { id: "emerald", label: "Emerald", swatch: "linear-gradient(135deg, #059669, #F97316)" },
];

/** The other theme: what the toggle switches to. */
export const otherTheme = (t: Theme): Theme => (t === "dark" ? "light" : "dark");

const root = () => document.documentElement;
export const currentTheme = (): Theme => (root().dataset.theme === "dark" ? "dark" : "light");
const currentPalette = () => root().dataset.palette ?? "aurora";

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the choice just is not remembered
  }
}

/** The active palette and a setter that applies and remembers it. */
export function usePalette(): [string, (p: string) => void] {
  const [palette, setPalette] = useState(currentPalette);
  useEffect(() => {
    root().dataset.palette = palette;
    remember(PALETTE_KEY, palette);
  }, [palette]);
  return [palette, setPalette];
}

/** The active theme and a toggle that applies and remembers it. */
export function useThemeToggle(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    root().dataset.theme = theme;
    remember(THEME_KEY, theme);
  }, [theme]);
  return [theme, () => setTheme(otherTheme)];
}

/**
 * A key that changes whenever the theme or the palette changes ("dark aurora"). Canvas charts (uPlot) and map
 * tiles cannot follow CSS variables by themselves: put this key in the deps of the effect that builds them.
 */
export function useThemeKey(): string {
  const get = () => `${currentTheme()} ${currentPalette()}`;
  const [key, setKey] = useState(get);
  useEffect(() => {
    const mo = new MutationObserver(() => setKey(get()));
    mo.observe(root(), { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
    return () => mo.disconnect();
  }, []);
  return key;
}
