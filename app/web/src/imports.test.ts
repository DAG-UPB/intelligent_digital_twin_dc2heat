/** The import directions of AUDIT-2026-11-24.md's target layering: lib/ imports no page, api/ no lib/ value, ui/ not the
 * shell (app/), and nothing outside pages/twin imports it (it composes the others). Read from the sources as text. */
import { expect, test } from "vitest";

const SOURCES = import.meta.glob(["./**/*.ts", "./**/*.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// What cannot move yet, each with its reason: "<importing file> -> <imported file>"
const ALLOWED = new Set([
  // the type Approach belongs to the modelling page's approaches.ts, which reads the page's state; moves with R16
  "lib/ports.ts -> pages/datacenter/modelling/approaches.ts",
  // the Quick analysis reads what Heat Matching last ran (the browser's heat-matching key) and shows its CO₂ facts; the
  // page-to-page contract (matchingSetup.ts) and HeatFactsInfo move out of pages/twin with R10/R13
  "pages/district/quickAnalysis.ts -> pages/twin/matchingSetup.ts",
  "pages/district/QuickWindow.tsx -> pages/twin/matchingSetup.ts",
  "pages/district/QuickWindow.tsx -> pages/twin/HeatFactsInfo.tsx",
  // the chart's colours follow the theme: useThemeKey lives with the shell's theme (app/theme.ts), moving it is its own change
  "ui/LineChart.tsx -> app/theme.ts",
  // the test checks that the parts' KPIs feed the same roles as the data center's (kpiVariables.ts, a page's module)
  "lib/partKpis.test.ts -> pages/datacenter/modelling/kpiVariables.ts",
]);

/** Every import of a file: its target resolved against the file, and whether it is only a type. */
function importsOf(file: string, text: string) {
  const out: { to: string; typeOnly: boolean }[] = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s+"(\.[^"]+)"/gm)) {
    const parts = file.split("/").slice(0, -1);
    for (const seg of m[4].split("/")) seg === ".." ? parts.pop() : seg !== "." && parts.push(seg);
    const typeOnly =
      !!m[2] ||
      (/^\{[^}]*\}$/.test(m[3]) &&
        m[3]
          .slice(1, -1)
          .split(",")
          .every((x) => !x.trim() || x.trim().startsWith("type ")));
    out.push({ to: parts.join("/"), typeOnly });
  }
  return out;
}

const resolve = (to: string) => ["", ".ts", ".tsx", "/index.ts"].map((ext) => to + ext).find((p) => p in SOURCES) ?? to;

test("the import directions hold", () => {
  const broken: string[] = [];
  for (const [path, text] of Object.entries(SOURCES)) {
    const file = path.slice(2); // "./lib/x.ts" -> "lib/x.ts"
    for (const { to, typeOnly } of importsOf(path, text)) {
      const target = resolve(to).replace(/^\.\//, "");
      const rule =
        file.startsWith("lib/") && target.startsWith("pages/")
          ? "lib imports a page"
          : file.startsWith("api/") && target.startsWith("lib/") && !typeOnly
            ? "api imports a lib value"
            : file.startsWith("ui/") && target.startsWith("app/")
              ? "ui imports the shell"
              : target.startsWith("pages/twin/") && !file.startsWith("pages/twin/")
                ? "pages/twin is imported"
                : null;
      if (rule && !ALLOWED.has(`${file} -> ${target}`)) broken.push(`${rule}: ${file} -> ${target}`);
    }
  }
  expect(broken).toEqual([]);
});

test("the scan reads the imports", () => {
  expect(Object.keys(SOURCES).length).toBeGreaterThan(300);
  expect(importsOf("./lib/a.ts", 'import { x, type Y } from "../pages/b";\nimport type { Z } from "./c";')).toEqual([
    { to: "./pages/b", typeOnly: false },
    { to: "./lib/c", typeOnly: true },
  ]);
});
