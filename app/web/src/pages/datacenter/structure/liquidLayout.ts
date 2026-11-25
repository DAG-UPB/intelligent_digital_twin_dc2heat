/**
 * The built-in P&ID of a liquid-cooled data center (DrawnLiquid; dataset.json heat_source has a "liquid" point, as
 * sim_1_water): its units for the sensor taps and the default spot of each variable, in the W x H frame. Pure data.
 */
import type { Box, Taps } from "./geometry";
import { DEFAULTS, type Pos } from "./layout";

export const LIQUID_INTRO =
  "The P&ID of a liquid-cooled data center.";

/** Units (x, y, w, h) of DrawnLiquid. */
export const LIQUID_UNITS: Record<string, Box> = {
  rackRow1: [140, 230, 300, 30],
  rackRow2: [140, 370, 300, 30],
  rearDoor1: [140, 260, 300, 6], // the rear doors face the hot aisle between the rows
  rearDoor2: [140, 364, 300, 6],
  cdu: [500, 205, 90, 235],
  hexLiq: [700, 268, 40, 24],
  fhx: [880, 262, 40, 36], // the facility HEX on the tower water
  phe: [700, 470, 40, 24], // free cooling of the chilled water
  chiller: [760, 470, 90, 90],
  hexCond: [880, 483, 40, 24],
  tower: [960, 470, 80, 80],
};

const MEASURES: Record<string, string | null> = {
  IT_Load: "rackRow",
  ITE_Ener: "rackRow",
  HVAC_Ener: "chiller",
  Cool_Set: "rearDoor", // the air the rear doors leave in the hall
  HEX_Liq_T_in: "hexLiq",
  HEX_Liq_T_out: "hexLiq",
  HEX_Liq_m: "hexLiq",
  HEX_Cond_T_in: "hexCond",
  HEX_Cond_T_out: "hexCond",
  HEX_Cond_m: "hexCond",
  FC_Share: "phe",
  Heat_Demand: null,
  In_Temp: null,
  In_Hum: null,
  Out_Temp: null,
  Out_Hum: null,
  Out_Wind: null,
  Out_Wind_Dir: null,
  Hour: null,
  solar_radiation: null,
};

export const LIQUID_TAPS: Taps = { units: LIQUID_UNITS, measures: MEASURES };

/** The weather and the demand as on the air-cooled drawing; the rest beside what it measures. */
export const LIQUID_DEFAULTS: Pos = {
  Out_Temp: DEFAULTS.Out_Temp,
  Out_Hum: DEFAULTS.Out_Hum,
  Out_Wind: DEFAULTS.Out_Wind,
  Out_Wind_Dir: DEFAULTS.Out_Wind_Dir,
  Hour: DEFAULTS.Hour,
  solar_radiation: DEFAULTS.solar_radiation,
  Heat_Demand: DEFAULTS.Heat_Demand,
  Heat_rejected: { x: 1060, y: 400, tag: "QT" }, // beside the cooling tower, below the facility HEX
  // the hall's air in the hot aisle, between the rows' rack-water lines; the IT below the lower row
  In_Hum: { x: 200, y: 305, tag: "MT" },
  In_Temp: { x: 330, y: 305, tag: "TT" },
  Cool_Set: { x: 470, y: 305, tag: "TIC" },
  IT_Load: { x: 200, y: 462, tag: "JT" },
  ITE_Ener: { x: 330, y: 462, tag: "EQ" },
  // the liquid cooling HEX on the facility water: water from the CDU, water on to the facility HEX, its flow below
  HEX_Liq_T_in: { x: 650, y: 215, tag: "TT" },
  HEX_Liq_T_out: { x: 800, y: 215, tag: "TT" },
  HEX_Liq_m: { x: 720, y: 335, tag: "FT" },
  // the plant, as the air-cooled one's: its electricity, the free-cooled share, the condenser HEX
  HVAC_Ener: { x: 805, y: 420, tag: "EQ" },
  FC_Share: { x: 650, y: 600, tag: "KI" },
  HEX_Cond_T_in: { x: 1010, y: 420, tag: "TT" },
  HEX_Cond_m: { x: 862, y: 600, tag: "FT" },
  HEX_Cond_T_out: { x: 940, y: 600, tag: "TT" },
};
