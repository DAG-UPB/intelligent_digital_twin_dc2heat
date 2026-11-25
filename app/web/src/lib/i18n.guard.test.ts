/** Every static English text of the pages has its German: JSX text and the label/title/hint/aria-label literals must be
 * translated by the dictionary (i18n.de.ts, as the page's translator reads it). A wording edit in a page silently drops
 * its German otherwise. Dictionary entries no source has any more are printed as a warning, not a failure. */
import ts from "typescript";
import { expect, test } from "vitest";
import { translator } from "./i18n";
import DE from "./i18n.de";

const SOURCES = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const ALL = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!./i18n.de.ts"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const ATTRS = new Set(["label", "title", "hint", "aria-label"]);
// the same in both languages: units, symbols, names, the app's own terms, words German writes alike, and formulas
// (a text with "=" or an identifier_with_underscore)
const SAME =
  /^(?:[A-Z][A-Za-z]?|min|max|[A-Z0-9_]+|[A-Za-z]+\d[\w]*|n?MAE|[kMG]Wh?(\/a)?|MWh\/\(m·a\)|°C|COP|PUE|SCOP|CO₂( \(t\))?|NPV|LCOH|MPC|BEW|KWW|DN|P&ID|DEXPI|SMARD|TabPFN|XGBoost|Chronos-2|TempCaFe|PCMCI|OpenStreetMap|Leaflet|uPlot|MCP|JSON|CSV|Parquet|Wärmeatlas|ERA5|Open-Meteo|Claude Code|digital-twin|Name|Code|Tutorial|Variable|\+ Variable|Optional|System|Details…|in|T (min|max)|\(warm\)|kW\):)$|=|\w_\w/;

const decode = (t: string) =>
  t
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const needsGerman = (t: string) => /[A-Za-z]{2}/.test(t) && !SAME.test(t);
// the dictionary's patterns with their slots unnumbered: a text run of a page with {…} in it is covered by one of them
const PATTERNS = new Set(
  Object.keys(DE)
    .filter((k) => /\{\d+\}/.test(k))
    .map((k) => norm(k.replace(/\{\d+\}/g, "{}"))),
);

/** The static texts of one .tsx that need their German: its JSX text (a run of text and {values} between two elements is
 * one text on the page, covered by a pattern or else piece by piece) and the string literals of the attributes people
 * read. Skipped as the page skips them: <code>, <pre> and translate="no"; also a formula's <sub>/<sup> indices. */
function textsOf(file: string, source: string): string[] {
  const out: string[] = [];
  const skipped = (n: ts.JsxElement) =>
    ["code", "pre", "sub", "sup"].includes(n.openingElement.tagName.getText()) || // code, and a formula's indices
    n.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "translate");
  const runs = (children: ts.NodeArray<ts.JsxChild>) => {
    let run: ts.JsxChild[] = [];
    const flush = () => {
      const texts = run
        .filter(ts.isJsxText)
        .map((t) => norm(decode(t.text)))
        .filter(needsGerman);
      const lit = (c: ts.JsxChild) => (ts.isJsxExpression(c) && c.expression && ts.isStringLiteral(c.expression) ? c.expression.text : "{}"); // {" "}
      const template = norm(run.map((c) => (ts.isJsxText(c) ? decode(c.text) : lit(c))).join(""));
      if (texts.length && !(run.some((c) => !ts.isJsxText(c)) && PATTERNS.has(template))) out.push(...texts);
      run = [];
    };
    for (const c of children) {
      if (ts.isJsxText(c) || (ts.isJsxExpression(c) && c.expression && !ts.isJsxElement(c.expression))) run.push(c);
      else flush();
    }
    flush();
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxElement(n) && skipped(n)) return;
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) runs(n.children);
    if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText()) && n.initializer) {
      const v = n.initializer;
      const e = ts.isJsxExpression(v) ? v.expression : v;
      if (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && needsGerman(norm(e.text))) out.push(norm(e.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return out;
}

test("every static text of the pages has its German", () => {
  const tr = translator(DE);
  const missing = Object.entries(SOURCES).flatMap(([file, src]) =>
    textsOf(file, src)
      .filter((t) => tr(t) == null)
      .map((t) => `${file.slice(3)}: ${t}`),
  );
  expect(missing).toEqual([]);
});

test("the scan finds the texts", () => {
  const page = '<Card title="Heat sinks" hint={"x"}><p>Plan the network</p><b>{n}</b> MWh <i>{n} heat sinks not supplied</i><code>x_y</code></Card>';
  expect(textsOf("x.tsx", page)).toEqual(["Heat sinks", "Plan the network"]); // the run "{n} heat sinks not supplied" is a pattern
});

test("dictionary entries no source has any more (a warning)", () => {
  const all = norm(decode(Object.values(ALL).join("\n")));
  const stale = Object.keys(DE).filter((en) => !/\{\d+\}/.test(en) && !all.includes(norm(en)) && !all.includes(JSON.stringify(en).slice(1, -1)));
  if (stale.length) console.warn(`i18n: ${stale.length} entries of i18n.de.ts appear in no source (wording changed?), e.g. ${stale.slice(0, 5).join(" | ")}`);
  expect(Object.keys(DE).length).toBeGreaterThan(1000);
});
