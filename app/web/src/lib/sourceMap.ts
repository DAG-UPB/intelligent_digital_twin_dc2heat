/** Heat source mapping of Heat distribution: which data columns are the data center's heat (pure). */

/**
 * Where the data center's heat comes from on Heat distribution, when dataset.json has no heat_source:
 * a heat column (kW) x factor, or factor x |T_hot − T_cold| from two temperatures (factor = flow x c_p, kW/K);
 * t = the column with the source temperature. Saved in site.json as heat_source_map. t_out (only from dataset.json
 * heat_source) is the loop's measured return temperature; the delta kind's cold column is its return.
 */
export type HeatSourceMap =
  | { kind: "column"; q: string; factor: number; t: string; t_out?: string }
  | { kind: "delta"; hot: string; cold: string; factor: number; t: string };

export const mapColumns = (m: HeatSourceMap) => [...new Set(m.kind === "column" ? [m.q, m.t, ...(m.t_out ? [m.t_out] : [])] : [m.hot, m.cold, m.t])];

export function asHeatSourceMap(x: unknown, columns: string[]): HeatSourceMap | null {
  const m = x as HeatSourceMap | null;
  if (!m || (m.kind !== "column" && m.kind !== "delta")) return null;
  return mapColumns(m).every((c) => columns.includes(c)) && Number.isFinite(m.factor) ? m : null;
}

/** A first guess: a power/heat column if there is one, else the difference of the two first temperatures. */
export function guessHeatSourceMap(columns: string[], heat: string[]): HeatSourceMap | null {
  const temps = [...heat, ...columns].filter((c, i, a) => a.indexOf(c) === i && /temp|_t\d*$|^t\d|--t\d/i.test(c));
  const powers = columns.filter((c) => /heat|power|_q$|kw|ener/i.test(c) && !/temp/i.test(c));
  const power = powers.find((c) => /^it|ite/i.test(c)) ?? powers[0];
  if (power) return { kind: "column", q: power, factor: 1, t: temps[0] ?? power };
  if (temps.length >= 2) return { kind: "delta", hot: temps[0], cold: temps[1], factor: 1, t: temps[0] };
  return null;
}

/** Heat (kW), its temperature (°C) and, when measured, the return temperature from a mapping and the columns it names. */
export function applyMap(m: HeatSourceMap, c: Record<string, number[]>): { q: number[]; t: number[]; tOut?: number[] } {
  if (m.kind === "delta") return { q: c[m.hot].map((x, i) => m.factor * Math.abs(x - c[m.cold][i])), t: c[m.t], tOut: c[m.cold] };
  return { q: c[m.q].map((x) => x * m.factor), t: c[m.t], ...(m.t_out ? { tOut: c[m.t_out] } : {}) };
}

/** The columns the physics source needs (only the simulation has them). */
export const DRIVER_COLUMNS = ["ITE_Ener", "HVAC_Ener", "In_Temp", "Out_Temp"];

/**
 * The columns of the heat-recovery options other than `option` (dataset.json heat_source), minus any the selected
 * option also uses: the Physical structure and Scenarios graphs hide them (hidden, never deleted from the graph).
 * Empty when `option` is not one of the options.
 */
export function otherOptionColumns(heatSource: Record<string, Partial<Record<string, string>>> | null | undefined, option: string): Set<string> {
  if (!heatSource?.[option]) return new Set();
  const keep = new Set(Object.values(heatSource[option]));
  const other = Object.entries(heatSource).flatMap(([k, p]) => (k === option ? [] : Object.values(p)));
  return new Set(other.filter((c): c is string => !!c && !keep.has(c)));
}

/** A calculated column of dataset.json "derived": a heat exchanger's heat Q = m · cp · (T_in − T_out) (kW from kg/s, kJ/(kg·K), K). */
export type Derived = { m: string; t_in: string; t_out: string; cp: number };

const partsOf = (d: Derived) => [d.m, d.t_in, d.t_out];

/** Q = m · cp · (T_in − T_out) per step, from the columns of its parts (same formula as backend/core/derived.py). */
export const derivedQ = (d: Derived, c: Record<string, ArrayLike<number>>): number[] =>
  Array.from(c[d.m], (m, i) => m * d.cp * (c[d.t_in][i] - c[d.t_out][i]));

/** The derived columns whose parts are all in `have` (e.g. the variables a model predicts): they can be computed. */
export const derivable = (derived: Record<string, Derived> | null | undefined, have: Iterable<string>): string[] => {
  const h = new Set(have);
  return Object.entries(derived ?? {})
    .filter(([, d]) => partsOf(d).every((c) => h.has(c)))
    .map(([k]) => k);
};

/**
 * What the graph views (Physical structure, Scenarios) hide: the other heat-recovery option's columns and every
 * calculated column, so the selected HEX shows its T_in, T_out and m only. Hidden, never deleted.
 */
export const hiddenColumns = (
  config: { heat_source?: Record<string, Partial<Record<string, string>>> | null; derived?: Record<string, Derived> | null } | null | undefined,
  option: string,
): Set<string> => new Set([...otherOptionColumns(config?.heat_source, option), ...Object.keys(config?.derived ?? {})]);
