/**
 * The KPIs of the heat distribution and the district (the Structure page's KPI variables button), with the variables
 * they are worked out from: their formulas under the drawing's names and what each variable feeds, as the data
 * center's (pages/datacenter/modelling/kpiVariables.ts). Σ is over the period, Δt the time step. Pure.
 */
import { fmt } from "./format";

/** One KPI: its formula with the bound variables, or null and what is missing; what it means (its info mark). */
export interface KpiLine {
  label: string;
  formula: string | null;
  missing: string[];
  about: string;
}

/** CO₂ of the heat a gas boiler would have made, and of the grid electricity the heat pump draws (Germany). */
export const CO2 = {
  gas: 0.201, // kg CO₂ per kWh of natural gas burnt (UBA, CO₂-Emissionsfaktoren für fossile Brennstoffe, 2022)
  boiler: 0.9, // a gas boiler's seasonal efficiency: the gas per kWh of heat is 1 / 0.9
  grid: 0.38, // kg CO₂ per kWh of German grid electricity (UBA, Strommix 2023: about 380 g/kWh)
};
// ponytail: fixed factors; a year's or a site's own (a green tariff, the local grid) would go here as settings

export interface PartKpis {
  lines: KpiLine[];
  uses: Record<string, string>; // variable -> its part in the KPIs ("role · KPI, KPI"), as kpiUses
}

const line = (label: string, formula: string, about: string): KpiLine => ({ label, formula, missing: [], about });

/** The heat distribution's: the heat pump's COP, the share of the data center's waste heat used, its electricity. */
export function heatKpis(n: (v: string) => string = (v) => v): PartKpis {
  const [qdc, qhex, qhp, pel] = ["Q_dc", "Q_hex", "Q_hp", "P_el_hp"].map(n);
  return {
    lines: [
      line(
        "COP",
        `Σ ${qhp} / Σ ${pel}`,
        "Coefficient of performance of the heat pump over the period: the heat it delivers per unit of its electricity. Higher is better; 3 to 5 for a heat pump on data-center waste heat.",
      ),
      line(
        "Waste heat used",
        `Σ (${qhex} + ${qhp} − ${pel}) / Σ ${qdc}`,
        "The share of the data center's waste heat that reaches the district: what the heat exchanger passes on plus what the heat pump takes from the water (its heat minus its electricity), over the waste heat offered. 0 to 1; higher is better.",
      ),
      line(
        "Electricity use",
        `Σ ${pel} × Δt`,
        "The electricity the heat distribution uses over the period (the heat pump's compressor), in kWh or MWh. Lower is better for the same heat.",
      ),
    ],
    uses: {
      [qdc]: "Waste heat · Waste heat used",
      [qhex]: "Heat exchanger heat · Waste heat used",
      [qhp]: "Heat pump heat · COP, Waste heat used",
      [pel]: "Heat pump electricity · COP, Waste heat used, Electricity use",
    },
  };
}

/** The district's: the share of its demand the heat distribution covers, the energy it uses, the CO₂ saved against gas. */
export function districtKpis(n: (v: string) => string = (v) => v): PartKpis {
  const [demand, qhex, qhp, pel] = ["Q_houses", "Q_hex", "Q_hp", "P_el_hp"].map(n);
  const delivered = `(${qhex} + ${qhp})`;
  return {
    lines: [
      line(
        "Demand covered",
        `Σ ${delivered} / Σ ${demand}`,
        "The share of the buildings' heat demand covered by the heat distribution (the data center's waste heat, through the heat exchanger and the heat pump). 0 to 1; higher is better.",
      ),
      line("Energy used", `Σ ${demand} × Δt`, "The heat the buildings use over the period, in kWh or MWh."),
      line(
        "CO₂ saved",
        `Σ ${delivered} × Δt × ${CO2.gas} / ${CO2.boiler} − Σ ${pel} × Δt × ${CO2.grid}`,
        `The CO₂ the buildings save against heating with gas: the heat delivered, had a gas boiler made it (${CO2.gas} kg CO₂ per kWh of gas, ${CO2.boiler * 100} % efficient), minus the CO₂ of the heat pump's grid electricity (${CO2.grid} kg per kWh), in kg or t. Higher is better.`,
      ),
    ],
    uses: { [demand]: "Heat demand · Demand covered, Energy used" },
  };
}

/** The factors "CO₂ saved" is counted with (Heat Matching, the quick analysis), in words, to show beside it (the numbers
 * through the page's format); Operation counts the grid's CO₂ by the hour (pages/twin/operation.ts). */
export const co2Basis = () =>
  `gas ${fmt(CO2.gas, 3)} kg CO₂ per kWh in a boiler of ${fmt(CO2.boiler * 100)} %, grid electricity ${fmt(CO2.grid, 2)} kg per kWh (Germany's mix, the same in every hour and every year; Operation counts the grid's CO₂ hour by hour, so its tonnes differ)`;

/** The factors in short, for the quick analysis's "?" texts: "CO₂ 0,201 kg/kWh gas at 90 %, grid 0,38 kg/kWh in every hour". */
export const co2Short = () => `CO₂ ${fmt(CO2.gas, 3)} kg/kWh gas at ${fmt(CO2.boiler * 100)} %, grid ${fmt(CO2.grid, 2)} kg/kWh in every hour`;

/** The CO₂ saved against gas, in t, from the heat delivered and the heat pump's electricity, in MWh (as "CO₂ saved"). */
export const co2SavedT = (deliveredMwh: number, hpElecMwh: number) => (deliveredMwh * CO2.gas) / CO2.boiler - hpElecMwh * CO2.grid;
