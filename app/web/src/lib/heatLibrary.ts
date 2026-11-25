/**
 * Known equations of the heat distribution's parts (heat pump, heat exchanger, storage tank, water loops, district),
 * for the Physics model under its structure: the same form as the data center's library (physicsLibrary.ts), with
 * the standard equations of this other system. Slot guesses match the heat distribution's variables and, where a data
 * center measures them, its columns.
 */
import type { LibraryEquation } from "./physicsLibrary";

const T_SUPPLY_DC = { label: "Data center's supply temperature (source)", guess: /T_dc_supply|T_HP_source|HEX_Cond_T_in/i };
const T_RETURN_DH = { label: "District's return temperature", guess: /T_dh_return|T_DH_cold/i };

export const HEAT_LIBRARY: LibraryEquation[] = [
  {
    id: "hp-cop",
    group: "Heat pump",
    name: "COP (Carnot)",
    about: "COP = η_C · T_sink / (T_sink − T_source), temperatures in kelvin; η_C is the share of the Carnot COP reached (0.4…0.6).",
    expr: "eta * ({T_sink} + 273.15) / maximum({T_sink} - {T_source}, 1)",
    coefs: { eta: { label: "Carnot efficiency η_C (0…1)", typical: 0.5 } },
    target: /COP/i,
    slots: { T_sink: { label: "Sink (supply) temperature", guess: /T_hp_out|T_HP_sink|T_dh_supply/i }, T_source: T_SUPPLY_DC },
  },
  {
    id: "hp-heat",
    group: "Heat pump",
    name: "Heat delivered from its load",
    about: "The heat pump runs at its load (0 % off … 100 % full power) of its thermal capacity.",
    expr: "Q_max * {load} / 100",
    coefs: { Q_max: { label: "Thermal capacity at full power (kW)", typical: 2000 } },
    target: /Q_hp/i,
    slots: { load: { label: "Load (%)", guess: /hp_load/i } },
  },
  {
    id: "hp-el",
    group: "Heat pump",
    name: "Electricity",
    about: "P_el = Q / COP: the heat delivered over the coefficient of performance.",
    expr: "{Q} / maximum({COP}, 1)",
    coefs: {},
    target: /P_el/i,
    slots: { Q: { label: "Heat delivered", guess: /Q_hp/i }, COP: { label: "COP", guess: /COP/i } },
  },
  {
    id: "hx-q",
    group: "Heat exchanger",
    name: "Heat flow (ε-NTU)",
    about: "Q = ε · C_min · (T_hot,in − T_cold,in); k lumps ε · C_min (constant flows). Heat flows only while the source is hotter.",
    expr: "k * maximum({T_hot} - {T_cold}, 0)",
    coefs: { k: { label: "ε · C_min: heat flow per kelvin (kW/K)", typical: 50 } },
    target: /Q_hex|HEX_.*_Q/i,
    slots: { T_hot: T_SUPPLY_DC, T_cold: T_RETURN_DH },
  },
  {
    id: "hx-out",
    group: "Heat exchanger",
    name: "District-side outlet temperature",
    about: "The district's water warms toward the hot inlet by the effectiveness ε (0…1).",
    expr: "{T_cold} + eps * ({T_hot} - {T_cold})",
    coefs: { eps: { label: "Effectiveness of the exchanger (0…1)", typical: 0.7 } },
    target: /T_hex_out/i,
    slots: { T_hot: T_SUPPLY_DC, T_cold: T_RETURN_DH },
  },
  {
    id: "tank-energy",
    group: "Storage tank",
    name: "Energy balance",
    about: "E[t] = E[t−1] + Δt · (heat in − heat out) − loss · E[t−1]: charged by the units, discharged by the demand.",
    expr: "{self} + dt * ({Q_in} - {Q_out}) - loss * {self}",
    coefs: { dt: { label: "Step length (h): kWh per kW", typical: 1 }, loss: { label: "Standing loss per step (0…1)", typical: 0.005 } },
    target: /E_tank/i,
    slots: { Q_in: { label: "Heat in (units)", guess: /Q_hex|Q_hp/i }, Q_out: { label: "Heat out (demand)", guess: /Q_demand|Heat_Demand/i } },
  },
  {
    id: "tank-temp",
    group: "Storage tank",
    name: "Temperature from its energy",
    about: "A stratified tank's temperature rises with its stored energy above the return temperature.",
    expr: "{T_ret} + a * {E}",
    coefs: { a: { label: "K per kWh stored (1 / heat capacity)", typical: 0.01 } },
    target: /T_tank/i,
    slots: { E: { label: "Stored energy", guess: /E_tank/i }, T_ret: T_RETURN_DH },
  },
  {
    id: "loop-return",
    group: "Water loops",
    name: "Return temperature of a loop",
    about: "Q = ṁ · c_p · ΔT: the return is the supply minus the heat taken out over the flow (c_p of water 4.19 kJ/(kg·K)).",
    expr: "{T_sup} - {Q} / (cp * maximum({m}, 0.01))",
    coefs: { cp: { label: "Heat capacity of water (kJ/(kg·K))", typical: 4.19 } },
    target: /return|_cold/i,
    slots: {
      T_sup: { label: "Supply temperature", guess: /T_dc_supply|T_dh_supply/i },
      Q: { label: "Heat taken out", guess: /Q_hex|Q_demand/i },
      m: { label: "Mass flow (kg/s)", guess: /m_dc|m_dh/i },
    },
  },
  {
    id: "district-demand",
    group: "District",
    name: "Heat demand from the outdoor temperature",
    about: "Space heating below the heating limit, plus a base load (hot water): k · max(T_limit − T_out, 0) + base.",
    expr: "k * maximum(T_limit - {T_air}, 0) + base",
    coefs: {
      k: { label: "kW per kelvin below the limit", typical: 50 },
      T_limit: { label: "Heating limit (°C)", typical: 15 },
      base: { label: "Base load, e.g. hot water (kW)", typical: 100 },
    },
    target: /Q_demand|Heat_Demand/i,
    slots: { T_air: { label: "Outdoor temperature", guess: /T_outdoor|Out_Temp/i } },
  },
];
