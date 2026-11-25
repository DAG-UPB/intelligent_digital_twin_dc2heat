/** Text of the AI modelling page: nMAE as a percent and its colour, lags, coefficient names, structural equations. */
import type { TrainedModel } from "../../../api";
import { fmt } from "../../../lib/format";

/** nMAE in percent, lower is better ("–" when there is none), in the numbers' format: "12,3%" beside fmt's "1.461". */
export const pct = (x: number | null | undefined) => (x == null ? "–" : `${fmt(x * 100, 1)}%`);

/** Colour of an nMAE: ≤ 5 % ok, ≤ 15 % warn, otherwise danger. */
export function nmaeColor(x: number | null | undefined) {
  if (x == null) return "var(--foreground-tertiary)";
  return x <= 0.05 ? "var(--ok)" : x <= 0.15 ? "var(--warn)" : "var(--danger)";
}

/** First free coefficient name in an expression: c1, c2, … */
export function nextCoef(expr: string) {
  let k = 1;
  while (new RegExp(`\\bc${k}\\b`).test(expr)) k++;
  return `c${k}`;
}

const lagText = (lag: number) => (lag === 0 ? "t" : `t−${Math.abs(lag)}`);

/** Lags as a compact list: runs of 3 or more are shortened, 1,2,3,5 -> "t−1…3, t−5". */
export function lagRange(lags: number[]) {
  const ls = [...new Set(lags.map(Math.abs))].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ls.length; ) {
    let j = i;
    while (j + 1 < ls.length && ls[j + 1] === ls[j] + 1) j++;
    parts.push(j - i >= 2 ? `${lagText(ls[i])}…${ls[j]}` : ls.slice(i, j + 1).map(lagText).join(", "));
    i = j + 1;
  }
  return parts.join(", ");
}

/** A formula with its fitted coefficients filled in (3 significant digits); `Name[t-1]` data references stay as they are. */
export function withParams(rhs: string, params: Record<string, number>) {
  // an identifier with its [..] index is a data reference, so a coefficient named like a column or "t" is never hit inside one
  return rhs.replace(/\b[A-Za-z_]\w*(\[[^\]]*\])?/g, (m, index?: string) => (!index && Object.hasOwn(params, m) ? params[m].toPrecision(3) : m));
}

/**
 * Structural equation of one variable in a model. Physics/symbolic: the fitted formula. XGBoost/TabPFN (black boxes):
 * which inputs at which lags. Linear: the intercept and the `maxTerms` largest effects (|coef| x std of the input).
 */
export function equation(v: string, m: TrainedModel, maxTerms = 8) {
  const fit = m.variables[v];
  if (fit.equation) return `${v}(t) = ${withParams(fit.equation, fit.params ?? {})}`;
  if (m.kind === "xgboost" || m.kind === "tabpfn") {
    const byParent = new Map<string, number[]>();
    for (const i of fit.inputs) byParent.set(i.parent, [...(byParent.get(i.parent) ?? []), i.lag]);
    return `${v}(t) = f( ${[...byParent].map(([p, lags]) => `${p}(${lagRange(lags)})`).join(", ")} )`;
  }
  const effect = (i: (typeof fit.inputs)[number]) => Math.abs(i.coef) * (i.std ?? 1);
  const ranked = [...fit.inputs].sort((a, b) => effect(b) - effect(a));
  const terms = ranked.slice(0, maxTerms).map((i) => `${i.coef < 0 ? "−" : "+"} ${Math.abs(i.coef).toPrecision(3)}·${i.parent}(${lagText(i.lag)})`);
  const rest = ranked.length - terms.length;
  return `${v}(t) = ${fit.intercept.toPrecision(3)} ${terms.join(" ")}${rest > 0 ? ` + … (${rest} more terms)` : ""}`;
}

/** Learned coefficients as "k = 0.5 · b = 2.00". */
export const learnedText = (params: Record<string, number>) =>
  Object.entries(params)
    .map(([k, x]) => `${k} = ${x.toPrecision(3)}`)
    .join(" · ");
