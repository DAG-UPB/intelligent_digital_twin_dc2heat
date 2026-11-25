/**
 * The district's built-in drawing (DistrictDrawing): the weather beside it as on every structure, the heat
 * distribution as a grey box on the left where the district connects to it, its supply and return to the buildings,
 * and the variables it starts with. A very simple causal graph: the weather, the hour and the number of units drive the
 * flow the buildings draw (measured on the return) and what they leave in the return; the heat demand Q_houses is
 * calculated from the water (drawn on the supply where it leaves the heat distribution, with no tap, and named as
 * before so saved graphs keep it). T_dh_supply, T_dh_return and m_dh are the heat distribution's names for the same water: where the
 * two structures meet. Coordinates are in the structure page's W × H frame. Pure data.
 */
import type { Box, Taps } from "../../datacenter/structure/geometry";
import type { Pos } from "../../datacenter/structure/layout";
import type { Link } from "../../datacenter/structure/links";
import type { Notes } from "../../datacenter/structure/notes";
import { WEATHER_DEFAULTS, WEATHER_MEASURES, WEATHER_NOTES, WEATHER_VARS } from "../../datacenter/structure/weatherBand";

export const UNITS: Record<string, Box> = {
  heat: [40, 150, 160, 380], // the heat distribution: the neighbour, its own structure
  dhSupply: [200, 198, 300, 4], // y 200, 240: the connection point, as on every structure
  dhReturn: [200, 238, 300, 4],
  buildings: [520, 310, 410, 130],
};

/** In the new form (DistrictDrawing framed) the heat distribution is on the margin and the pipes start at the box's
 * edge (x 0): the taps land on them there. */
const FRAMED: Record<string, Box | null> = { heat: null, dhSupply: [0, 198, 500, 4], dhReturn: [0, 238, 500, 4] };

const MEASURES: Record<string, string | null> = {
  ...WEATHER_MEASURES,
  Q_houses: null, // on the supply line itself: no tap
  n_units: null, // a number, not a measurement: no tap
  T_dh_supply: "dhSupply",
  m_dh: "dhReturn",
  T_dh_return: "dhReturn",
};

export const DISTRICT_TAPS: Taps = { units: UNITS, measures: MEASURES, framed: FRAMED };

export const DISTRICT_DEFAULTS: Pos = {
  ...WEATHER_DEFAULTS,
  Q_houses: { x: 250, y: 200, tag: "QT" }, // on the supply, where it leaves the heat distribution
  T_dh_supply: { x: 330, y: 150, tag: "TT" },
  m_dh: { x: 400, y: 300, tag: "FT" }, // on the return, as a district heat meter has it
  T_dh_return: { x: 290, y: 300, tag: "TT" },
  n_units: { x: 1000, y: 340, tag: "N" }, // beside the buildings
};

/** The variables a new district starts with (until its graph file has some). */
export const DISTRICT_STARTER = Object.keys(DISTRICT_DEFAULTS).sort();

/** effect <- its causes, one step back. The heat distribution sets the supply temperature by the outdoor one (its
 * heating curve). What the buildings need (the weather, the hour, how many units there are, the supply temperature,
 * and their own past: buildings store heat) sets the flow they draw, and the return is what they leave of the water.
 * The heat demand is calculated from these, Q = m · cp · (T_supply − T_return): it causes nothing. */
const CAUSES: Record<string, string[]> = {
  T_dh_supply: ["T_outdoor"],
  m_dh: [...WEATHER_VARS, "n_units", "T_dh_supply", "m_dh"],
  T_dh_return: ["T_dh_supply", "m_dh", "T_outdoor", "n_units"],
  Q_houses: ["m_dh", "T_dh_supply", "T_dh_return"],
};

export const DISTRICT_LINKS: Link[] = Object.entries(CAUSES).flatMap(([to, from]) => from.map((f) => ({ from: f, to, lags: [1] })));

export const DISTRICT_NOTES: Notes = {
  ...WEATHER_NOTES,
  Q_houses: {
    kind: "calculated",
    note: "The buildings' heat demand (kW), one variable for all of them: Q = m_dh · cp · (T_dh_supply − T_dh_return)",
  },
  n_units: { note: "Number of units connected (houses or flats; the site's heat sinks): a number for the district" },
  T_dh_supply: { note: "Supply temperature from the heat distribution (its T_dh_supply)" },
  m_dh: { note: "Mass flow of the district heating water, measured on the return (the heat distribution's m_dh)" },
  T_dh_return: { note: "Return temperature to the heat distribution (its T_dh_return)" },
};
