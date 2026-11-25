/**
 * A structure's starting variables bound to the data: the weather band's generic names (T_outdoor, humidity, ...),
 * the heat demand (the district's Q_houses, the heat distribution's Q_demand) and the heat distribution's side of the
 * heat exchanger the data center uses (dataset.json heat_source of its hex_option: the water from and back to the
 * data center, its flow, the heat) become the data center's own columns when it has them, so the starting graph has
 * data to show, to learn lags from and to model. A name the data already has, or one without a column, stays as it
 * is, and so does one whose column is calculated (dataset.json derived: never a graph node). Pure: no React, no
 * fetching.
 */
import type { DatasetConfig } from "../../../dataset";
import type { Link } from "./links";
import type { StructureSetup } from "./structureSetup";

/** The generic names and what the data calls them (the first matching column; never the wind's direction). */
const COLUMN_OF: [string, RegExp][] = [
  ["T_outdoor", /^(out_?temp|t_?out(door)?|outdoor_?temp|ambient_?temp|temperature_2m)/i],
  ["humidity", /^(out_?hum|relative_?humidity|humidity)/i],
  ["wind_speed", /^(out_?wind(_?speed)?|wind_?speed)$/i],
  ["wind_direction", /^(out_?wind_?dir|wind_?dir(ection)?)/i],
  ["solar_radiation", /(solar|irradiance|shortwave|global_?radiation)/i],
  ["hour", /^hour$/i],
  // the data center's inputs and outputs (pages/heat/ports.ts DC_INTERFACE)
  ["IT_load", /^it_?load$/i],
  ["IT_power", /^(ite_?ener|it_?power|it_?energy|it_?elec|p_?it$)/i],
  ["Cooling_power", /^(hvac_?ener|cooling_?(power|energy|elec)|p_?cool)/i],
  ["Heat_rejected", /^(q_?env|heat_?reject)/i],
];

/** The generic names a column can be made "the same" as on the drawing ("=": dataset.json names, column -> name). */
export const GENERIC = new Set(COLUMN_OF.map(([name]) => name));

/** generic name -> the data's column, for the names the data has a column for; `hex`: the heat_source option used.
 * A column shown under a generic name (dataset.json names, set by "=" on the drawing) is that name's, first. */
export function renameFor(columns: string[], config: DatasetConfig, hex?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [c, name] of Object.entries(config.names ?? {})) if (GENERIC.has(name) && columns.includes(c) && !columns.includes(name)) out[name] ??= c;
  for (const [name, re] of COLUMN_OF) {
    const c = columns.find((x) => re.test(x));
    if (c && !columns.includes(name)) out[name] ??= c;
  }
  const sources = config.heat_source ?? {};
  const point = sources[hex ?? ""] ?? Object.values(sources)[0];
  const bound: Record<string, string | undefined> = {
    Q_houses: config.kpi?.heat_demand,
    Q_demand: config.kpi?.heat_demand,
    Q_hex: point?.q,
    // the water to the heat distribution and back (HeatPoint): the loop's where the point has it, else the HEX's hot side
    T_dc_supply: [point?.t, point?.t_in].find((c) => c && columns.includes(c)),
    T_dc_return: [point?.t_return, point?.t_out].find((c) => c && columns.includes(c)),
    m_dc: point?.m,
  };
  const calculated = new Set(Object.keys(config.derived ?? {})); // Q = m · cp · ΔT: never a graph node
  for (const [name, c] of Object.entries(bound)) if (c && columns.includes(c) && !calculated.has(c) && !columns.includes(name)) out[name] = c;
  return out;
}

const renamed = <T>(rec: Record<string, T>, to: (v: string) => string) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [to(k), v]));

/** The setup with its starting variables renamed: positions, starter, links, notes, taps and actuators. */
export function bindSetup(setup: StructureSetup, rename: Record<string, string>): StructureSetup {
  if (!Object.keys(rename).length) return setup;
  const to = (v: string) => rename[v] ?? v;
  return {
    ...setup,
    defaults: renamed(setup.defaults, to),
    taps: { ...setup.taps, measures: renamed(setup.taps.measures, to) },
    starter: setup.starter.map(to).sort(),
    ports: setup.ports.map(to),
    portPoints: Object.fromEntries(
      Object.entries(setup.portPoints).map(([side, vars]) => [side, Object.fromEntries(Object.entries(vars).map(([role, v]) => [role, v && to(v)]))]),
    ),
    starterLinks: setup.starterLinks.map((l: Link) => ({ ...l, from: to(l.from), to: to(l.to) })),
    starterNotes: renamed(setup.starterNotes, to),
    actuators: setup.actuators.map(to),
  };
}
