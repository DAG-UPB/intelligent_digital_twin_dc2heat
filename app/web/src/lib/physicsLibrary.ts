/**
 * Known equations of data-center components, for the Physics model on the AI modelling page.
 *
 * In `expr`, `{slot}` is a data variable (picked by the user, written as Var[t-1]) and `{self}`
 * is the predicted variable one step back. Every other name is a coefficient (`coefs`): learned
 * from the data, or fixed by the user to a known value.
 * `guess` picks a default column for a slot (first match).
 */
export type LibraryEquation = {
  id: string;
  group: string;
  name: string;
  about: string;
  expr: string;
  target: RegExp;
  slots: Record<string, { label: string; guess: RegExp }>;
  coefs: Record<string, { label: string; typical: number }>;
};

const IT = { label: "IT electrical power", guess: /ITE_Ener|IT.*(Ener|Power)/i };
const T_OUT = { label: "Outdoor air temperature", guess: /Out_Temp/i };

export const LIBRARY: LibraryEquation[] = [
  {
    id: "it-heat",
    group: "Heat exchangers",
    name: "Heat recovered from IT",
    about: "Almost all electrical power of the servers becomes heat; eta is the share the heat exchanger captures.",
    expr: "eta * {P}",
    coefs: { eta: { label: "Share of IT power recovered as heat (0…1)", typical: 0.8 } },
    target: /HEX_Hall_Q/,
    slots: { P: IT },
  },
  {
    id: "hex-q",
    group: "Heat exchangers",
    name: "Heat exchanger, heat flow (ε-NTU)",
    about: "Q = ε · C_min · (T_hot,in − T_cold,in). k lumps ε · C_min (constant flows).",
    expr: "k * ({T_hot} - {T_cold})",
    coefs: { k: { label: "ε · C_min: heat flow per kelvin of temperature difference", typical: 1 } },
    target: /HEX_.*_Q/,
    slots: { T_hot: { label: "Hot side inlet temperature", guess: /HEX_Hall_T_in|In_Temp/ }, T_cold: { label: "Cold side inlet temperature", guess: /Out_Temp/ } },
  },
  {
    id: "hex-t",
    group: "Heat exchangers",
    name: "Heat exchanger, outlet temperature",
    about: "The hot stream cools toward the cold inlet by the effectiveness eps (0…1).",
    expr: "{T_hot} - eps * ({T_hot} - {T_cold})",
    coefs: { eps: { label: "Effectiveness of the exchanger (0…1)", typical: 0.7 } },
    target: /HEX_.*_T_out/,
    slots: { T_hot: { label: "Hot side inlet temperature", guess: /HEX_Hall_T_in|In_Temp/ }, T_cold: { label: "Cold side inlet temperature", guess: /Out_Temp/ } },
  },
  {
    id: "dry-cooler",
    group: "Heat rejection",
    name: "Dry cooler / cooling tower outlet",
    about: "Outlet follows outdoor air plus an approach, but never below a minimum (controlled) temperature T_min.",
    expr: "maximum({T_air} + approach, T_min)",
    coefs: { approach: { label: "Approach: outlet above air temperature (K)", typical: 5 }, T_min: { label: "Lowest outlet temperature, controlled (°C)", typical: 12 } },
    target: /HEX_Cond_T_in/,
    slots: { T_air: T_OUT },
  },
  {
    id: "chiller",
    group: "Heat rejection",
    name: "Chiller electrical power (Carnot COP)",
    about: "P = Q / COP with COP = eta · T_evap / (T_cond − T_evap), temperatures in K; P0 = standby power.",
    expr: "{Q} * ({T_cond} - {T_evap}) / (eta * ({T_evap} + 273.15)) + P0",
    coefs: { eta: { label: "Share of the Carnot COP the chiller reaches (0…1)", typical: 0.5 }, P0: { label: "Standby power", typical: 0 } },
    target: /HVAC_Ener/,
    slots: { Q: { label: "Cooling load (heat removed)", guess: /ITE_Ener/ }, T_cond: { label: "Condenser temperature", guess: /HEX_Cond_T_in|Out_Temp/ }, T_evap: { label: "Evaporator / room temperature", guess: /In_Temp/ } },
  },
  {
    id: "cooling-power",
    group: "Heat rejection",
    name: "Cooling power vs IT load and weather",
    about: "Cooling power grows with the heat to remove, more on hot days.",
    expr: "a * {P} * (1 + b * {T_air}) + c",
    coefs: { a: { label: "Cooling power per unit of IT power", typical: 0.1 }, b: { label: "Extra share per K of outdoor temperature", typical: 0.02 }, c: { label: "Base load", typical: 0 } },
    target: /HVAC_Ener/,
    slots: { P: IT, T_air: T_OUT },
  },
  {
    id: "heat-pump",
    group: "Heat pumps & storage",
    name: "Heat pump heat output (Carnot COP)",
    about: "Q = P · COP with COP = eta · T_sink / (T_sink − T_source), temperatures in K.",
    expr: "{P} * eta * ({T_sink} + 273.15) / ({T_sink} - {T_src})",
    coefs: { eta: { label: "Share of the Carnot COP the heat pump reaches (0…1)", typical: 0.5 } },
    target: /HEX_.*_Q/,
    slots: { P: { label: "Heat pump electrical power", guess: /HVAC_Ener/ }, T_sink: { label: "Supply (sink) temperature", guess: /HEX_Cond_T_in|HEX_Hall_T_in/ }, T_src: { label: "Source temperature", guess: /In_Temp/ } },
  },
  {
    id: "tank",
    group: "Heat pumps & storage",
    name: "Thermal storage tank",
    about: "Energy balance: heat in minus heat out changes the temperature; b is the loss to the surroundings.",
    expr: "{self} + a * ({Q_in} - {Q_out}) - b * ({self} - {T_amb})",
    coefs: { a: { label: "1 / heat capacity: K per unit of energy", typical: 0.01 }, b: { label: "Heat loss to the surroundings per hour (0…1)", typical: 0.01 } },
    target: /_T$/,
    slots: { Q_in: { label: "Heat in", guess: /HEX_Hall_Q/ }, Q_out: { label: "Heat out (demand)", guess: /Heat_Demand|HEX_Cond_Q/ }, T_amb: { label: "Ambient temperature", guess: /Out_Temp/ } },
  },
  {
    id: "room",
    group: "Rooms & pipes",
    name: "Room / thermal mass (first-order RC)",
    about: "The room moves toward the cooling setpoint at rate a and is heated by the IT load (b).",
    expr: "{self} + a * ({T_set} - {self}) + b * {Q}",
    coefs: { a: { label: "How fast the room follows the setpoint, per hour (0…1)", typical: 0.3 }, b: { label: "K per unit of IT power", typical: 0.01 } },
    target: /In_Temp/,
    slots: { T_set: { label: "Cooling setpoint / supply air", guess: /Cool_Set/ }, Q: IT },
  },
  {
    id: "pipe",
    group: "Rooms & pipes",
    name: "Pipe / duct heat loss",
    about: "Outlet temperature loses a share k of the difference to the surroundings.",
    expr: "{T_in} - k * ({T_in} - {T_amb})",
    coefs: { k: { label: "Share of the temperature difference lost (0…1)", typical: 0.05 } },
    target: /_T$/,
    slots: { T_in: { label: "Inlet temperature", guess: /HEX_Cond_T_out|HEX_Hall_T_out/ }, T_amb: { label: "Ambient temperature", guess: /Out_Temp/ } },
  },
  {
    id: "mix",
    group: "Rooms & pipes",
    name: "Mixing of two streams (valve)",
    about: "Mixed temperature with fraction x from stream A.",
    expr: "x * {T_a} + (1 - x) * {T_b}",
    coefs: { x: { label: "Fraction from stream A (0…1)", typical: 0.5 } },
    target: /_T$/,
    slots: { T_a: { label: "Stream A temperature", guess: /HEX_Hall_T_out/ }, T_b: { label: "Stream B temperature", guess: /HEX_Cond_T_out/ } },
  },
  {
    id: "pump",
    group: "Pumps & fans",
    name: "Pump or fan power (affinity law)",
    about: "Power grows with the cube of speed (or flow); P0 = power at standstill.",
    expr: "k * {n}**3 + P0",
    coefs: { k: { label: "Power at full speed ÷ speed³", typical: 1 }, P0: { label: "Power at standstill", typical: 0 } },
    target: /Ener|Power/i,
    slots: { n: { label: "Speed or flow", guess: /Speed|Flow|IT_Load/i } },
  },
  {
    id: "pump-hydraulic",
    group: "Pumps & fans",
    name: "Pump hydraulic power",
    about: "P = V̇ · Δp / η; k lumps 1/η and unit conversion.",
    expr: "k * {V} * {dp} + P0",
    coefs: { k: { label: "1 ÷ pump efficiency (with unit conversion)", typical: 1.5 }, P0: { label: "Power at standstill", typical: 0 } },
    target: /Ener|Power/i,
    slots: { V: { label: "Volume flow", guess: /Flow|IT_Load/i }, dp: { label: "Pressure difference (head)", guess: /Press|dp|Head/i } },
  },
];

/** First column matching the pattern; earlier alternatives (a|b) win over later ones. */
export function guessColumn(re: RegExp, columns: string[], fallback = columns[0]) {
  // splitting is only safe without groups, e.g. IT.*(Ener|Power) is tried as a whole
  const alts = re.source.includes("(") ? [re.source] : re.source.split("|");
  for (const alt of alts) {
    const hit = columns.find((c) => new RegExp(alt, re.flags).test(c));
    if (hit) return hit;
  }
  return fallback;
}

/**
 * The template with its slots filled: `{slot}` -> Column[t-1], `{self}` -> Target[t-1], and
 * fixed coefficients replaced by their value (the others stay names, learned from the data).
 */
export function fillEquation(eq: LibraryEquation, target: string, picks: Record<string, string>, fixed: Record<string, number> = {}) {
  let expr = eq.expr;
  for (const [k, v] of Object.entries(fixed)) expr = expr.replace(new RegExp(`(?<!\\{)\\b${k}\\b(?!\\})`, "g"), v < 0 ? `(${v})` : `${v}`);
  return expr.replace(/\{(\w+)\}/g, (_, s: string) => `${s === "self" ? target : picks[s]}[t-1]`);
}
