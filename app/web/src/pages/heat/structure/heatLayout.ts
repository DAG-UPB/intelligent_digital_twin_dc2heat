/**
 * The heat distribution's built-in drawing (HeatDrawing): its units and pipes, and the variables it starts with, each
 * placed at the part it measures with a tap onto it. They cover the water on both sides of every part (heat, supply
 * and return temperature, mass flow), the heat supplied by the data center and the district's demand. Coordinates are
 * in the structure page's W × H frame. Pure data.
 */
import { W, type Box, type Taps } from "../../datacenter/structure/geometry";
import type { Pos } from "../../datacenter/structure/layout";
import type { Link } from "../../datacenter/structure/links";
import type { Notes } from "../../datacenter/structure/notes";
import { WEATHER_DEFAULTS, WEATHER_MEASURES, WEATHER_NOTES } from "../../datacenter/structure/weatherBand";

/** The units, and the stretches of pipe the temperatures and flows tap onto (thin boxes along the pipe). The heat
 * exchanger and the heat pump are two equal boxes in one column: two parallel branches between the same headers. */
export const UNITS: Record<string, Box> = {
  dc: [40, 160, 140, 360],
  dcSupply: [180, 198, 110, 4], // the data center's supply, before the header (y 200, 240: the connection point)
  dcReturn: [180, 238, 80, 4],
  hex: [400, 180, 140, 100],
  hexOut: [540, 198, 110, 4], // district side, heated
  hp: [400, 390, 140, 120],
  compressor: [458, 413, 24, 24],
  hpOut: [540, 408, 110, 4],
  hpIn: [540, 488, 140, 4],
  tank: [770, 200, 80, 260],
  districtSupply: [880, 198, 60, 4], // "district...": the district's own taps land here in the new form, its box gone
  districtReturn: [900, 238, 40, 4],
  district: [940, 160, 140, 360],
};

/** In the new form (HeatDrawing framed) the neighbours' boxes are on the margins and the pipes run on to the box's
 * edges (x 0 and W): what measured a neighbour taps onto its pipes ("dc..." and "district..." prefixes). */
const FRAMED: Record<string, Box | null> = {
  dc: null,
  dcSupply: [0, 198, 290, 4],
  dcReturn: [0, 238, 260, 4],
  district: null,
  districtSupply: [880, 198, W - 880, 4],
  districtReturn: [900, 238, W - 900, 4],
};

/** What each starting variable measures (null: no tap, it is the part's own state or the weather). */
const MEASURES: Record<string, string | null> = {
  Q_dc: "dc",
  T_dc_supply: "dcSupply",
  m_dc: "dcReturn", // under its return temperature
  T_dc_return: "dcReturn",
  Q_hex: "hex",
  T_hex_out: "hexOut",
  m_hex: "hexOut",
  P_el_hp: "compressor",
  hp_load: "hp",
  COP: null,
  Q_hp: "hp",
  T_hp_out: "hpOut",
  m_hp: "hpIn",
  E_tank: null,
  T_tank_top: "tank",
  T_tank_bottom: "tank",
  T_dh_supply: "districtSupply",
  T_dh_return: "districtReturn",
  Q_demand: "district",
  m_dh: "district",
  ...WEATHER_MEASURES,
};

export const HEAT_TAPS: Taps = { units: UNITS, measures: MEASURES, framed: FRAMED };

export const HEAT_DEFAULTS: Pos = {
  ...WEATHER_DEFAULTS, // beside the connection point, as on every structure
  // the data center: the heat it supplies (exogenous) and its water loop
  Q_dc: { x: 110, y: 140, tag: "QT" },
  T_dc_supply: { x: 190, y: 140, tag: "TT" },
  T_dc_return: { x: 215, y: 290, tag: "TT" },
  m_dc: { x: 215, y: 360, tag: "FT" },
  // the heat exchanger: its heat and the district-side water it heats
  Q_hex: { x: 520, y: 125, tag: "QT" },
  m_hex: { x: 590, y: 145, tag: "FT" },
  T_hex_out: { x: 660, y: 145, tag: "TT" },
  // the heat pump, in parallel: electricity, COP, the heat it delivers and its district-side water
  P_el_hp: { x: 450, y: 350, tag: "EQ" },
  hp_load: { x: 340, y: 345, tag: "JIC" }, // the actuator: its load in %
  Q_hp: { x: 530, y: 350, tag: "QT" },
  T_hp_out: { x: 605, y: 350, tag: "TT" },
  COP: { x: 370, y: 580, tag: "KI" },
  m_hp: { x: 640, y: 550, tag: "FT" },
  // the storage tank: its energy and the temperatures at the top and the bottom
  E_tank: { x: 810, y: 330, tag: "QT" },
  T_tank_top: { x: 810, y: 150, tag: "TT" },
  T_tank_bottom: { x: 810, y: 520, tag: "TT" },
  // the district: its demand, its water
  T_dh_supply: { x: 910, y: 160, tag: "TT" },
  T_dh_return: { x: 920, y: 290, tag: "TT" },
  Q_demand: { x: 1010, y: 150, tag: "QT" },
  m_dh: { x: 1010, y: 560, tag: "FT" },
};

/** The variables a new heat distribution starts with (until its graph file has some). */
export const HEAT_STARTER = Object.keys(HEAT_DEFAULTS).sort();

/** effect <- its causes, one step back: the physics of the heat distribution as a first causal graph to edit. The
 * data center's heat, its pump (m_dc) and the weather are exogenous. */
const CAUSES: Record<string, string[]> = {
  // the data center's loop: its heat warms the supply; what the two units take out cools the return
  T_dc_supply: ["Q_dc", "m_dc", "T_dc_return"],
  T_dc_return: ["T_dc_supply", "Q_hex", "Q_hp"],
  // the district: the weather and the hour drive the demand, the demand the pumps; the return follows supply and demand
  Q_demand: ["T_outdoor", "solar_radiation", "hour"],
  m_dh: ["Q_demand"],
  m_hex: ["Q_demand"],
  m_hp: ["Q_demand"],
  T_dh_return: ["T_dh_supply", "Q_demand", "m_dh"],
  // the heat exchanger passes heat when the source is hotter than the district's return
  Q_hex: ["T_dc_supply", "T_dh_return", "m_hex"],
  T_hex_out: ["Q_hex", "m_hex", "T_dh_return"],
  // the heat pump is run (hp_load, 0..100 %) to cover what the heat exchanger does not; its COP falls with the lift,
  // its electricity is Q / COP
  hp_load: ["Q_demand", "Q_hex"],
  Q_hp: ["hp_load"],
  COP: ["T_dc_supply", "T_hp_out"],
  P_el_hp: ["Q_hp", "COP"],
  T_hp_out: ["Q_hp", "m_hp", "T_dh_return"],
  // the tank: charged by both units, discharged by the demand, its energy carried over (its own past)
  E_tank: ["E_tank", "Q_hex", "Q_hp", "Q_demand"],
  T_tank_top: ["E_tank", "T_hex_out", "T_hp_out"],
  T_tank_bottom: ["E_tank", "T_dh_return"],
  T_dh_supply: ["T_tank_top"],
};

/** The heat distribution's actuators: what a controller sets (drawn as a square). */
export const HEAT_ACTUATORS = ["hp_load"];
export const HEAT_NOTES: Notes = { ...WEATHER_NOTES, hp_load: { kind: "actuator", note: "The heat pump's load in %: 0 = off, 100 = full power" } };

export const HEAT_LINKS: Link[] = Object.entries(CAUSES).flatMap(([to, from]) => from.map((f) => ({ from: f, to, lags: [1] })));
