/**
 * Known equations of the district's heat demand, for the Physics model under its structure: the same form as the
 * data center's library (physicsLibrary.ts). First the demand as its graph has it, calculated from the water
 * (Q = m · cp · (T_supply − T_return)); then the standard estimates from the weather, buildings and habits, for a
 * district without flow and temperature data. Slot guesses match the district's variables and, where a data center
 * has them, its columns.
 */
import type { LibraryEquation } from "./physicsLibrary";

const T_AIR = { label: "Outdoor temperature", guess: /T_outdoor|Out_Temp/i };
const TARGET = /Q_houses|Q_demand|Heat_Demand/i;

export const DISTRICT_LIBRARY: LibraryEquation[] = [
  {
    id: "demand-water",
    group: "Heat demand",
    name: "From the water (calculated)",
    about: "The heat the buildings take from the water: Q = m · cp · (T_supply − T_return), m in kg/s, cp in kJ/(kg·K), Q in kW.",
    expr: "{m} * cp * ({T_sup} - {T_ret})",
    coefs: { cp: { label: "Heat capacity of water (kJ/(kg·K))", typical: 4.19 } },
    target: TARGET,
    slots: {
      m: { label: "Mass flow", guess: /^m_dh$/i },
      T_sup: { label: "Supply temperature", guess: /^T_dh_supply$/i },
      T_ret: { label: "Return temperature", guess: /^T_dh_return$/i },
    },
  },
  {
    id: "demand-outdoor",
    group: "Heat demand",
    name: "From the outdoor temperature",
    about: "Space heating below the heating limit, plus a base load (hot water): k · max(T_limit − T_out, 0) + base.",
    expr: "k * maximum(T_limit - {T_air}, 0) + base",
    coefs: {
      k: { label: "kW per kelvin below the limit", typical: 50 },
      T_limit: { label: "Heating limit (°C)", typical: 15 },
      base: { label: "Base load, e.g. hot water (kW)", typical: 100 },
    },
    target: TARGET,
    slots: { T_air: T_AIR },
  },
  {
    id: "demand-wind",
    group: "Heat demand",
    name: "Outdoor temperature and wind",
    about: "Wind raises the buildings' losses: the heating part grows by w per m/s of wind.",
    expr: "k * maximum(T_limit - {T_air}, 0) * (1 + w * {wind}) + base",
    coefs: {
      k: { label: "kW per kelvin below the limit", typical: 50 },
      T_limit: { label: "Heating limit (°C)", typical: 15 },
      w: { label: "Extra loss per m/s of wind (share)", typical: 0.03 },
      base: { label: "Base load, e.g. hot water (kW)", typical: 100 },
    },
    target: TARGET,
    slots: { T_air: T_AIR, wind: { label: "Wind speed", guess: /wind_speed|Out_Wind$/i } },
  },
  {
    id: "demand-inertia",
    group: "Heat demand",
    name: "Buildings that store heat",
    about: "The demand follows the weather slowly: a share a of the last step's demand stays, the rest follows the outdoor temperature.",
    expr: "a * {self} + (1 - a) * k * maximum(T_limit - {T_air}, 0)",
    coefs: {
      a: { label: "Share kept from the last step (0…1)", typical: 0.7 },
      k: { label: "kW per kelvin below the limit", typical: 50 },
      T_limit: { label: "Heating limit (°C)", typical: 15 },
    },
    target: TARGET,
    slots: { T_air: T_AIR },
  },
  {
    id: "demand-habits",
    group: "Daily habits",
    name: "Daily profile",
    about: "Households heat more in the morning and the evening: a daily wave around the mean, peaking at hour h0.",
    expr: "base + amp * cos(2 * 3.14159 * ({hour} - h0) / 24)",
    coefs: {
      base: { label: "Mean demand (kW)", typical: 500 },
      amp: { label: "Swing over the day (kW)", typical: 150 },
      h0: { label: "Hour of the peak", typical: 7 },
    },
    target: TARGET,
    slots: { hour: { label: "Hour of the day", guess: /^hour$|Hour/i } },
  },
];
