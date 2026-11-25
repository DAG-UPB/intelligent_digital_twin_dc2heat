/**
 * The connection points between the twin's three parts: what one part must deliver to the next, whatever its model.
 * Each point is two temperatures and the heat or the mass flow (Q = ṁ·cₚ·(T_supply − T_return) gives the other):
 *   waste heat     data center -> heat distribution, one per extraction point (dataset.json heat_source)
 *   district heat  heat distribution -> district: the demand and the network's supply and return
 *   weather        shared by all three: the outdoor temperature (needed), humidity and sun
 * Each part's Modelling shows its points and how each variable is made; Heat Matching runs on them. Pure.
 */
import type { DatasetConfig } from "../dataset";
import type { Approach } from "../pages/datacenter/modelling/approaches";
import type { HeatSourceMap } from "./sourceMap";

export type Role = "t_supply" | "t_return" | "q" | "m";

export const ROLES: { id: Role; label: string; unit: string }[] = [
  { id: "t_supply", label: "Supply temperature", unit: "°C" },
  { id: "t_return", label: "Return temperature", unit: "°C" },
  { id: "q", label: "Heat", unit: "kW" },
  { id: "m", label: "Mass flow", unit: "kg/s" },
];

/** Which variable plays each role at a point (none: not delivered). */
export type PointVars = Partial<Record<Role, string>>;

export interface Point {
  id: string;
  title: string;
  vars: PointVars;
}

/** How a part delivers a variable: by its approach in Modelling, as measured (a data column left as it is),
 * calculated from other columns (Q = ṁ·cₚ·ΔT), a constant setting of the part, or not at all. */
export type Delivery = Exclude<Approach, "off"> | "measured" | "calculated" | "setting" | "weather" | "missing";

export const DELIVERY_LABEL: Record<Delivery, string> = {
  data: "data-driven",
  physics: "physical",
  profile: "profile",
  measured: "measured",
  calculated: "calculated",
  setting: "setting",
  weather: "Site map weather",
  missing: "missing",
};

/** How variable `v` is delivered, from the Modelling approaches (null: calculated); `setting`: the part has a
 * constant for it (the district's supply and return on the Site map) when it is not modelled. */
export function deliveryOf(
  v: string | undefined,
  approach: Record<string, Approach | null>,
  columns: string[],
  inputs: string[],
  setting: false | "setting" | "weather" = false,
): Delivery {
  const fallback: Delivery = setting || "missing";
  if (!v) return fallback;
  const a = approach[v];
  if (a === null) return "calculated";
  if (a === undefined || a === "off" || (a === "data" && inputs.includes(v))) return columns.includes(v) ? "measured" : fallback;
  return a;
}

/** The roles still missing: both temperatures, and the heat or the flow. */
export function missingRoles(d: Partial<Record<Role, Delivery>>): Role[] {
  const has = (r: Role) => !!d[r] && d[r] !== "missing";
  const out = (["t_supply", "t_return"] as Role[]).filter((r) => !has(r));
  if (!has("q") && !has("m")) out.push("q");
  return out;
}

const TITLES: Record<string, string> = {
  hall: "Hall HEX · hot-aisle air",
  condenser: "Condenser HEX · cooling water",
  liquid: "Liquid cooling HEX · rack water",
  site: "Site map · its waste heat kW and °C, flat",
};
export const pointTitle = (id: string) => TITLES[id] ?? `${id.charAt(0).toUpperCase()}${id.slice(1)} · heat source`;

/** The data center's waste heat before it is mapped to columns: under the heat distribution's names for it, to be modelled. */
const WASTE: PointVars = { t_supply: "T_dc_supply", t_return: "T_dc_return", q: "Q_dc", m: "m_dc" };

/** The data center's points: each extraction point of dataset.json heat_source, else the mapping saved on the site
 * (site.json heat_source_map), else one point under the heat distribution's names, nothing delivered yet. */
export function dcPoints(config: DatasetConfig | null, map: HeatSourceMap | null): Point[] {
  const hs = Object.entries(config?.heat_source ?? {});
  if (hs.length) return hs.map(([id, p]) => ({ id, title: pointTitle(id), vars: { t_supply: p.t ?? p.t_in, t_return: p.t_return ?? p.t_out, q: p.q, m: p.m } }));
  if (map?.kind === "column") return [{ id: "mapped", title: "Waste heat · mapped columns", vars: { t_supply: map.t, t_return: map.t_out, q: map.q } }];
  if (map?.kind === "delta") return [{ id: "mapped", title: "Waste heat · mapped columns", vars: { t_supply: map.hot, t_return: map.cold } }];
  return [{ id: "waste", title: "Waste heat", vars: WASTE }];
}

/** The heat distribution's two points, by the names of its structure (`to`: a starting name -> the data's column). */
export function heatPoints(to: (v: string) => string): Point[] {
  return [
    {
      id: "from_dc",
      title: "From the data center · waste heat",
      vars: { t_supply: to("T_dc_supply"), t_return: to("T_dc_return"), q: to("Q_dc"), m: to("m_dc") },
    },
    {
      id: "to_district",
      title: "To the district · district heat",
      vars: { t_supply: to("T_dh_supply"), t_return: to("T_dh_return"), q: to("Q_demand"), m: to("m_dh") },
    },
  ];
}

/** The district's point: its heat demand and the network's water. */
export const districtPoint = (demand: string): Point => ({
  id: "district",
  title: "District heat · demand",
  vars: { q: demand, t_supply: "T_dh_supply", t_return: "T_dh_return", m: "m_dh" },
});

/** The data center's inputs and outputs besides its connection point and the weather, standard variables of its
 * structure (its data's columns where it has them: bindSetup.ts): what drives it, the IT load, and what it delivers,
 * its electricity (the IT's, some data have it, in others it follows from the IT load; the cooling's) and the heat the
 * cooling rejects to the environment. Nearly all the electricity becomes heat: recovered at the connection point or
 * rejected: Heat_rejected ≈ IT_power + Cooling_power − the heat recovered. Named as they read. */
export const DC_INTERFACE: { v: string; label: string; unit: string; io: "input" | "output"; tag: string }[] = [
  { v: "IT_load", label: "IT load", unit: "%", io: "input", tag: "JT" },
  { v: "IT_power", label: "IT electricity", unit: "kW", io: "output", tag: "EQ" },
  { v: "Cooling_power", label: "Cooling electricity", unit: "kW", io: "output", tag: "EQ" },
  { v: "Heat_rejected", label: "Heat to the environment", unit: "kW", io: "output", tag: "QT" },
];

/** The weather every part shares, by its structures' names: the minimal set that moves them (the outdoor temperature:
 * free cooling, the network, the demand; the humidity: the cooling tower's wet bulb; the sun: the buildings' gains).
 * Only the outdoor temperature is needed (the demand, the profiles and the calculations follow it): without data it is the Site map's weather (data, Open-Meteo or a typical year). */
export const WEATHER: { v: string; label: string; unit: string; needed?: boolean }[] = [
  { v: "T_outdoor", label: "Outdoor temperature", unit: "°C", needed: true },
  { v: "humidity", label: "Humidity", unit: "%" },
  { v: "solar_radiation", label: "Solar radiation", unit: "W/m²" },
];
/** The weather's tags, in WEATHER's order; then the rest of the weather's box, where the data or the structure has
 * them: the wind, its direction, the hour. */
export const WEATHER_TAGS = ["TT", "MT", "RT"];
export const WEATHER_MORE: [string, string][] = [
  ["wind_speed", "ST"],
  ["wind_direction", "ZT"],
  ["hour", "KI"],
];

/** Every variable of these points and of the weather (`to`: a generic name -> the data's column): what a part's
 * structure always has, whatever its graph file says, so each of them is made somehow. */
export const portVars = (points: Point[], to: (v: string) => string = (v) => v): string[] => [
  ...new Set([...points.flatMap((p) => Object.values(p.vars).filter((v): v is string => !!v)), ...WEATHER.map((w) => to(w.v))]),
];
