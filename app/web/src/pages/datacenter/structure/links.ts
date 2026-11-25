/**
 * Causal links of the Physical structure page and their conversion to and from the graph file.
 * The page shows and edits positive lags (steps back); the graph JSON stores them negative. Lag 0 = same hour.
 * A self-link (from === to) means "depends on its own past". Pure functions only.
 */
import type { CausalLinkStrength, CausalParent, LagDiscoveryResult } from "../../../api";

export interface Link {
  from: string;
  to: string;
  lags: number[]; // positive: steps back
}

export const keyOf = (l: { from: string; to: string }) => `${l.from}->${l.to}`;
export const isSelf = (l: Link) => l.from === l.to;

/** "1, 3;3 -2" -> [1, 2, 3]: unique absolute integers, sorted; junk is dropped. */
export const parseLags = (s: string) =>
  [...new Set(s.split(/[ ,;]+/).map((x) => Math.abs(parseInt(x, 10))).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);

/** Variables (targets and parents, sorted) and links (one per from->to, lags made positive) of a graph file. */
export function linksFromTargets(targets: Record<string, CausalParent[]>): { vars: string[]; links: Link[] } {
  const all = new Set([...Object.keys(targets), ...Object.values(targets).flatMap((ps) => ps.map((p) => p.parent))]);
  const byPair = new Map<string, Link>();
  for (const [to, ps] of Object.entries(targets))
    for (const { parent, lag } of ps) {
      const key = keyOf({ from: parent, to });
      if (!byPair.has(key)) byPair.set(key, { from: parent, to, lags: [] });
      byPair.get(key)!.lags.push(Math.abs(lag));
    }
  return { vars: [...all].sort(), links: [...byPair.values()] };
}

/** Every variable to draw: the graph's, plus every data column (a measured variable is shown even without links). */
export const withDataColumns = (vars: string[], columns: string[]): string[] =>
  [...new Set([...vars, ...columns.filter((c) => c !== "time")])].sort();

/** The graph file body: every variable as a target, and the strengths of the (from, to, lag) links still drawn. */
export function toSavePayload(vars: string[], links: Link[], strengths: CausalLinkStrength[]) {
  const targets: Record<string, CausalParent[]> = Object.fromEntries(vars.map((v) => [v, [] as CausalParent[]]));
  for (const l of links) for (const lag of l.lags) targets[l.to].push({ parent: l.from, lag: -lag });
  const keep = new Set(links.flatMap((l) => l.lags.map((lag) => `${l.from}|${l.to}|${lag}`)));
  return { targets, link_strengths: strengths.filter((s) => keep.has(`${s.source}|${s.target}|${Math.abs(s.lag)}`)) };
}

/** Own-past lags of each variable that has a self-link. */
export const selfLagsOf = (links: Link[]): Record<string, number[]> => Object.fromEntries(links.filter(isSelf).map((l) => [l.from, l.lags]));

/** A new link from -> to with lag 1, unless that pair is already linked. */
export const withLink = (links: Link[], from: string, to: string): Link[] =>
  links.some((l) => keyOf(l) === keyOf({ from, to })) ? links : [...links, { from, to, lags: [1] }];

/** Set a link's lags; no lags removes it. */
export const withLinkLags = (links: Link[], key: string, lags: number[]): Link[] =>
  lags.length ? links.map((l) => (keyOf(l) === key ? { ...l, lags } : l)) : links.filter((l) => keyOf(l) !== key);

/** Set a variable's own-past lags (lag 0 is meaningless there); none removes the self-link. */
export function withSelfLags(links: Link[], v: string, lags: number[]): Link[] {
  const own = lags.filter((x) => x > 0);
  const rest = links.filter((l) => keyOf(l) !== keyOf({ from: v, to: v }));
  return own.length ? [...rest, { from: v, to: v, lags: own }] : rest;
}

/**
 * Links where lag discovery found no significant lag. Discovery tests lags 1..max only, so a same-hour link
 * (lag 0, e.g. the HEX formulas) is never flagged.
 */
export function noEvidenceOf(links: Link[], res: LagDiscoveryResult): Set<string> {
  const sameHour = new Set(links.filter((l) => !isSelf(l) && l.lags.includes(0)).map(keyOf));
  return new Set(res.links.map((r) => `${r.source}->${r.target}`).filter((k, i) => !res.links[i].lags.length && !sameHour.has(k)));
}

/**
 * Links with the discovered lags: a link's lags are replaced by the found ones (keeping 0 when it had it); links
 * with none found stay as they are. Own-past lags are updated only where the graph already has a self-link:
 * the structure stays the user's.
 */
export function applyDiscoveredLags(links: Link[], res: LagDiscoveryResult): Link[] {
  const found = new Map(res.links.map((r) => [`${r.source}->${r.target}`, r.lags]));
  const cross = links
    .filter((l) => !isSelf(l))
    .map((l) => {
      const lags = found.get(keyOf(l)) ?? [];
      return lags.length ? { ...l, lags: [...(l.lags.includes(0) ? [0] : []), ...lags] } : l;
    });
  const hadSelf = new Set(links.filter(isSelf).map((l) => l.from));
  const selves = Object.entries(res.self)
    .filter(([v, lags]) => hadSelf.has(v) && lags.length)
    .map(([v, lags]) => ({ from: v, to: v, lags }));
  const keptSelves = links.filter((l) => isSelf(l) && !selves.some((x) => x.from === l.from));
  return [...cross, ...keptSelves, ...selves];
}

/** Every ordered pair of distinct variables: what a blind discovery (no drawn graph as prior) tests. */
export const allPairs = (vars: string[]) => vars.flatMap((a) => vars.filter((b) => b !== a).map((b) => ({ source: a, target: b })));

/**
 * Links after a blind discovery over `tested`: every link between two tested variables is replaced by the found ones
 * (own past too); links touching a variable that was not tested (no data, hidden) stay, as nothing was learnt about them.
 */
export function blindDiscovered(links: Link[], tested: string[], res: LagDiscoveryResult): Link[] {
  const t = new Set(tested);
  const kept = links.filter((l) => !t.has(l.from) || !t.has(l.to));
  const cross = res.links.filter((r) => r.lags.length).map((r) => ({ from: r.source, to: r.target, lags: r.lags }));
  const selves = Object.entries(res.self)
    .filter(([v, lags]) => t.has(v) && lags.length)
    .map(([v, lags]) => ({ from: v, to: v, lags }));
  return [...kept, ...cross, ...selves];
}

/** Strengths after lag discovery: the discovered ones replace any of the same (from, to, lag); the rest stay. */
export function withDiscoveredStrengths(strengths: CausalLinkStrength[], res: LagDiscoveryResult): CausalLinkStrength[] {
  const key = (s: CausalLinkStrength) => `${s.source}|${s.target}|${Math.abs(s.lag)}`;
  const found = res.link_strengths ?? [];
  const fresh = new Set(found.map(key));
  return [...strengths.filter((s) => !fresh.has(key(s))), ...found];
}

/** Status line after lag discovery. */
export const discoverySummary = (res: LagDiscoveryResult, noEvidence: number) =>
  `Lags updated for ${res.links.length - noEvidence} links.` +
  (noEvidence ? ` ${noEvidence} links show no significant lag (red, kept: delete them if you agree).` : "") +
  (res.skipped.length ? ` ${res.skipped.length} skipped: variables not in the data.` : "") +
  " Save to keep.";

/** Files of the dataset folder that are not graphs (backend NOT_GRAPHS). */
const NOT_GRAPHS = ["site.json", "dataset.json", "equations.json", "pid_plant.json"];

/** Why a "Save as" graph file name is not accepted, or null when it is (mirrors the backend's graph_name check). */
export function graphNameError(name: string): string | null {
  const n = name.trim();
  if (!/\.json$/i.test(n) || n.length <= 5 || /\.canvas\.json$/i.test(n)) return "Must end with .json.";
  if (/[/\\]|\.\./.test(n)) return "A file name, not a path.";
  if (NOT_GRAPHS.includes(n)) return `${n} is not a graph file: pick another name.`;
  return null;
}

/**
 * Line width of each drawn link from its strength: the largest |partial correlation| over its lags (as tigramite
 * reports it). The range is kept narrow (1.6..4 px) so weak links stay visible; links without a strength sit in
 * the middle.
 */
export function linkWidths(strengths: CausalLinkStrength[]): (key: string) => number {
  const best = new Map<string, number>();
  for (const st of strengths) {
    const k = keyOf({ from: st.source, to: st.target });
    best.set(k, Math.max(best.get(k) ?? 0, Math.abs(st.value)));
  }
  return (key) => {
    const r = best.get(key);
    return r === undefined ? 1.2 : 0.8 + 1.2 * Math.min(1, r);
  };
}

/** The links once `gone` is the same variable as `keep` ("=" on the drawing): its links become `keep`'s, a link
 * between the two is dropped, and two links that now join the same pair keep all their lags. */
export function mergedInto(links: Link[], gone: string, keep: string): Link[] {
  const out = new Map<string, Link>();
  for (const l of links) {
    const from = l.from === gone ? keep : l.from;
    const to = l.to === gone ? keep : l.to;
    if (from === to && (l.from === gone || l.to === gone)) continue; // the link between the two
    const k = `${from}\u0000${to}`;
    const had = out.get(k);
    out.set(k, { from, to, lags: had ? [...new Set([...had.lags, ...l.lags])].sort((a, b) => a - b) : l.lags });
  }
  return [...out.values()];
}
