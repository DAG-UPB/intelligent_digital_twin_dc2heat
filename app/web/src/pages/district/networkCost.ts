/**
 * The Site map's heat network in money, pure: what the planned network (network.ts) costs, what it earns and when it
 * pays off for the city that builds it. Each pipe gets the smallest DN that carries its largest hour on the typical
 * year, at least its design peak (the research's DN table: KWW costs per trench metre, the capacity at 150 Pa/m); the
 * heat-pump station is the plan's (network.ts: a share of the network's peak hour, at most what the data center's heat
 * gives). A fast heat-pump integration runs the app's own hourly year (quickAnalysis.ts sinkKw, lib/matching.ts
 * matchHeat) on the chosen buildings plus the pipes' heat losses: the heat pump's heat and electricity, and a gas peak
 * boiler for what it cannot cover. Then the cash flows over the horizon (prices rising, the demand falling with
 * renovation), the net present value, the break-even year and the levelised cost of heat. Every assumption is a
 * parameter with its source; the user's values live in this browser. For the time view, networkHours and hourAt give
 * the plan hour by hour: each building's and each pipe's heat, the water's speed, the heat pump, the boiler and the
 * data center's heat taken and spare, by month and on a winter and a summer day.
 */
import type { Site } from "../../api";
import { annualMwh, demandEntries, hottestIncluded, isIncluded } from "../../lib/demand";
import { DEFAULT_OPTIONS, matchHeat } from "../../lib/matching";
import { fmt } from "../../lib/format";
import { CO2 } from "../../lib/partKpis";
import { perMonth } from "../../lib/profile";
import { DC_SHARE, HP_SHARE, stationCapacity } from "./hpSizing";
import { buildingKw, DENSITY_PULL, type HeatNetwork, type Pipe } from "./network";
import { atHour } from "./networkView";
import { ceilingKw, flatDc, HOURS, RECOVERED, YEAR_TIMES, yearOutdoor, yearSupply } from "./quickAnalysis";
import { wasteKw } from "./siteEdits";

/** Where a default comes from: a short label and, when there is one, the link. */
export interface Source {
  label: string;
  url?: string;
}

const KWW: Source = {
  label: "KWW-Technikkatalog Wärmeplanung 1.1 (dena, 2026)",
  url: "https://api.kww-halle.de/fileadmin/PDFs/KWW-Technikkatalog-Waermeplanung_08-2026_Version_1.1.xlsx",
};
const KWW_DOC: Source = {
  label: "KWW-Technikkatalog, Begleitdokument (dena, 2026)",
  url: "https://api.kww-halle.de/fileadmin/PDFs/KWW-Technikkatalog-Waermeplanung_Begleitdokument_08-2026.pdf",
};
const DEA_NET: Source = { label: "Danish Energy Agency, Technology Data for Energy Transport (2025)", url: "https://ens.dk/media/7681/download" };
const DEA_HP: Source = { label: "Danish Energy Agency, Technology Data, waste-heat heat pump 3 MW (2025)", url: "https://ens.dk/media/8615/download" };
const FFM: Source = { label: "Jürgens et al. 2024, data-centre waste heat in Frankfurt, IJSEPM 41", url: "https://doi.org/10.54337/ijsepm.8149" };
const BEW: Source = {
  label: "BEW Richtlinie (BAnz AT 18.08.2022 B1)",
  url: "https://www.foerderdatenbank.de/FDB/Content/DE/Foerderprogramm/Bund/BMWi/bundesfoerderung-effiziente-waermenetze.html",
};
const BEW_M4: Source = {
  label: "BAFA, Merkblatt BEW Modul 4 (2023)",
  url: "https://www.bafa.de/SharedDocs/Downloads/DE/Energie/bew_merkblatt_antragstellung_m4.pdf?__blob=publicationFile",
};
const ESTIMATE: Source = { label: "estimate" };

/** One pipe size: inner diameter, € per trench metre (a supply and return pair, paved, 2026, net), heat loss of the
 * pair at 70/40 °C in ground of 10 °C, and what it carries at 150 Pa/m with 30 K between supply and return. */
export interface PipeDn {
  dn: number;
  innerMm: number;
  eurInnerCity: number;
  eurSuburban: number;
  lossW: number; // W/m
  kwAt30K: number;
}

// KWW Tab 36 (steel KMR pair per trench metre, paved Tiefbau + material); dimensions Energie AG 2025; losses an estimate
// (KWW's 110 °C losses scaled to 70/40 and twin pipes); capacity computed at 150 Pa/m, k = 0.05 mm (Nussbaumer &
// Thalmann 2017: 150-200 Pa/m); DN50 ≈ 243 kW matches DEA's "DN50 twin up to ~250 kW"
export const PIPE_DNS: PipeDn[] = [
  [20, 20.5, 492, 323, 10, 18],
  [25, 27.3, 596, 395, 13, 40],
  [32, 36.0, 740, 497, 14, 83],
  [40, 41.9, 898, 610, 15, 124],
  [50, 53.9, 1090, 749, 18, 243],
  [65, 69.7, 1370, 953, 21, 480],
  [80, 82.5, 1642, 1154, 22, 750],
  [100, 107.1, 1995, 1418, 23, 1490],
  [125, 132.5, 2424, 1741, 27, 2620],
  [150, 160.3, 2842, 2059, 32, 4320],
  [200, 210.1, 3654, 2684, 35, 8790],
  [250, 263.0, 4442, 3296, 50, 15800],
  [300, 312.7, 5210, 3899, 58, 24900],
].map(([dn, innerMm, eurInnerCity, eurSuburban, lossW, kwAt30K]) => ({ dn, innerMm, eurInnerCity, eurSuburban, lossW, kwAt30K }));
export const PIPE_SOURCE: Source = { ...KWW, label: "KWW Tab 36 (cost), Nussbaumer & Thalmann 2017 (150 Pa/m), losses an estimate" };

/** The smallest DN that carries `kw` with `dtK` between supply and return (the capacity scales with ΔT); when none
 * does, `n` pipes of the largest side by side (`over` then says so; n = 1 otherwise). */
export function pipeDn(kw: number, dtK: number): PipeDn & { over: boolean; n: number } {
  const fit = PIPE_DNS.find((d) => (d.kwAt30K * dtK) / 30 >= kw);
  const top = PIPE_DNS[PIPE_DNS.length - 1];
  return { ...(fit ?? top), over: !fit, n: fit ? 1 : Math.ceil(kw / ((top.kwAt30K * dtK) / 30)) };
}

export interface NetworkParams {
  area: "inner_city" | "suburban";
  pipeScale: number;
  sourceDtK: number;
  groundC: number;
  minDensity: number;
  densityPullPct: number; // how strongly the pipes prefer streets of high heat line density (network.ts densityPull), %
  reachM: number; // buildings join only this far from the station along the streets (network.ts reachM; 0: no limit)
  hpSharePct: number; // the heat pump's size, % of the network's peak hour (network.ts hpShare)
  dcSharePct: number; // buildings join while the heat pump (the data center's heat and its electricity) gives at least this % of the year's heat (network.ts minDcShare)
  fullPeak: boolean; // the old rule: the heat pump for the whole design peak, only the buildings it covers (network.ts fullPeak)
  useAll: boolean; // plan to use the data center's heat in full (network.ts useAll), not a compact network round the station
  hpEurPerKw: number;
  substationA: number;
  pumpsEurPerKw: number;
  boilerEurPerKw: number;
  gridEurPerKwEl: number;
  planningPct: number;
  contingencyPct: number;
  studyEur: number;
  bew: boolean;
  bewPct: number;
  bewOperating: boolean;
  heatPrice: number;
  aptMwh: number; // one apartment's heat a year: a building's apartments when its data gives none
  elecPrice: number;
  wasteHeatPrice: number;
  gasPrice: number;
  boilerEffPct: number;
  co2Price: number;
  co2Rise: number;
  hpOmPct: number;
  hpOmVar: number;
  netOmPerMw: number;
  netOmVar: number;
  substationOm: number;
  meteringEur: number;
  pumpHeadBar: number; // the network pumps' fixed head (station, house substation) on top of the longest path's pipes
  pumpEffPct: number;
  demandDeclinePct: number;
  escalationPct: number;
  discountPct: number;
  years: number;
  residual: boolean;
  pipeLife: number;
  hpLife: number;
  substationLife: number;
}

export const DEFAULT_PARAMS: NetworkParams = {
  area: "inner_city",
  pipeScale: 1,
  sourceDtK: 10,
  groundC: 10,
  minDensity: 1.5,
  densityPullPct: DENSITY_PULL * 100,
  reachM: 500,
  hpSharePct: HP_SHARE * 100,
  dcSharePct: DC_SHARE * 100,
  fullPeak: false,
  useAll: false,
  hpEurPerKw: 950,
  substationA: 2070,
  pumpsEurPerKw: 100,
  boilerEurPerKw: 100,
  gridEurPerKwEl: 130,
  planningPct: 15,
  contingencyPct: 10,
  studyEur: 100_000,
  bew: true,
  bewPct: 40,
  bewOperating: true,
  heatPrice: 130,
  aptMwh: 9,
  elecPrice: 179,
  wasteHeatPrice: 0,
  gasPrice: 60,
  boilerEffPct: 95,
  co2Price: 60,
  co2Rise: 8,
  hpOmPct: 3,
  hpOmVar: 2,
  netOmPerMw: 1000,
  netOmVar: 2,
  substationOm: 170,
  meteringEur: 150,
  pumpHeadBar: 1,
  pumpEffPct: 70,
  demandDeclinePct: 1.3,
  escalationPct: 2,
  discountPct: 5,
  years: 20,
  residual: true,
  pipeLife: 40,
  hpLife: 25,
  substationLife: 25,
};

type NumberKey = { [K in keyof NetworkParams]: NetworkParams[K] extends number ? K : never }[keyof NetworkParams];

/** A number among the assumptions: its field (label, unit, range) and its default's source. */
export interface ParamDef {
  key: NumberKey;
  group: "Investment" | "Operation" | "Money";
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  source: Source;
  note?: string;
}

export const PARAMS: ParamDef[] = [
  {
    key: "pipeScale",
    group: "Investment",
    label: "Pipe cost factor",
    unit: "×",
    min: 0.3,
    max: 2,
    step: 0.05,
    source: KWW,
    note: "on the DN table; ~0.5 is the Danish level (DEA), the Frankfurt study ~1,000 €/m with house connections",
  },
  {
    key: "hpEurPerKw",
    group: "Investment",
    label: "Heat-pump station",
    unit: "€/kW",
    min: 300,
    max: 2500,
    step: 10,
    source: DEA_HP,
    note: "per kW of heat; with its building, electrics, controls and engineering (KWW's curve: ~940 €/kW at 5 MW)",
  },
  {
    key: "substationA",
    group: "Investment",
    label: "House substation, a in a·P^0.38",
    unit: "€",
    min: 500,
    max: 5000,
    step: 10,
    source: KWW,
    note: "KWW Tab 40, installed: ~5,000 € at 10 kW, 12,000 € at 100 kW, 20,000 € at 500 kW",
  },
  {
    key: "pumpsEurPerKw",
    group: "Investment",
    label: "Network pumps",
    unit: "€/kW",
    min: 0,
    max: 300,
    step: 5,
    source: KWW,
    note: "KWW Tab 39 (> 1 MW), per kW of the network's peak (its largest hour)",
  },
  {
    key: "boilerEurPerKw",
    group: "Investment",
    label: "Gas peak boiler",
    unit: "€/kW",
    min: 0,
    max: 300,
    step: 5,
    source: KWW,
    note: "KWW Tab 20: 140 €/kW at 0.5 MW, 60 at 10 MW; 100 in between is interpolated",
  },
  {
    key: "gridEurPerKwEl",
    group: "Investment",
    label: "Grid connection (BKZ)",
    unit: "€/kW el",
    min: 0,
    max: 400,
    step: 5,
    source: {
      label: "Netze Duisburg, Baukostenzuschuss 2026",
      url: "https://www.netze-duisburg.de/fileadmin/user_upload/Netz_nutzen/Netzzugang/Strom/251212_Netze_Duisburg_-_Preisblatt_Baukostenzuschuss_2026.pdf",
    },
    note: "medium voltage: 142 €/kW in Duisburg, 88 in Stuttgart; per kW of the heat pump's electricity",
  },
  {
    key: "planningPct",
    group: "Investment",
    label: "Planning",
    unit: "%",
    min: 0,
    max: 40,
    step: 1,
    source: DEA_NET,
    note: "design, permits, tender, supervision; on the pipes, pumps and substations (the heat pump's price has its engineering)",
  },
  {
    key: "contingencyPct",
    group: "Investment",
    label: "Contingency",
    unit: "%",
    min: 0,
    max: 50,
    step: 1,
    source: ESTIMATE,
    note: "on everything; KWW gives its costs ±25-30 %",
  },
  {
    key: "studyEur",
    group: "Investment",
    label: "Feasibility study",
    unit: "€",
    min: 0,
    max: 1_000_000,
    step: 5000,
    source: ESTIMATE,
    note: "BEW Modul 1 pays half of it",
  },
  {
    key: "bewPct",
    group: "Investment",
    label: "BEW grant (Modul 2)",
    unit: "%",
    min: 0,
    max: 40,
    step: 1,
    source: BEW,
    note: "of the eligible investment (not the gas boiler), at most the funding gap; new networks need ≥ 75 % waste or renewable heat and > 16 buildings",
  },
  {
    key: "sourceDtK",
    group: "Investment",
    label: "ΔT of the data center's loop",
    unit: "K",
    min: 3,
    max: 30,
    step: 1,
    source: ESTIMATE,
    note: "sizes the transmission line: its warm water (e.g. 30/20 °C) carries less per pipe than the 70/40 network",
  },
  {
    key: "reachM",
    group: "Investment",
    label: "Reach of the station along the streets",
    unit: "m",
    min: 0,
    max: 3000,
    step: 50,
    source: ESTIMATE,
    note: "a compact network round the station: buildings further along the streets are left out (0: no limit); a long branch to one far building rarely pays once crossings and permits are counted",
  },
  {
    key: "minDensity",
    group: "Investment",
    label: "Minimum heat density of a branch",
    unit: "MWh/(m·a)",
    min: 0,
    max: 10,
    step: 0.1,
    source: {
      label: "Stadt Würzburg, Quartierskonzept Heidingsfeld II",
      url: "https://www.wuerzburg.de/media/www.wuerzburg.de/org/med_512847/563070_quartierskonzept_heidingsfeld_teil_ii.pdf",
    },
    note: "a branch carrying less is cut from the plan; rule of thumb > 1.5, QM Holzheizwerke 1.8, the Frankfurt study 2.9",
  },
  {
    key: "densityPullPct",
    group: "Investment",
    label: "Prefer dense streets",
    unit: "%",
    min: 0,
    max: 100,
    step: 10,
    source: ESTIMATE,
    note: "with the Wärmeatlas street segments loaded: the pipes take a longer way along streets of high heat line density (MWh per m of street and year) where it is not much longer; 0: always the shortest way. At 100 % a street of 1.5 MWh/(m·a) counts half its metres in the choice, one of 6 or more a fifth; the pipe, its cost and losses keep the real metres",
  },
  {
    key: "hpSharePct",
    group: "Investment",
    label: "Heat pump size",
    unit: "% of the peak hour",
    min: 10,
    max: 100,
    step: 5,
    source: DEA_HP,
    note: "of the network's peak hour, at most what the data center's heat allows; a gas peak boiler covers the rest. On the typical year 50 % gives ~86 % of the heat, DEA's 85 %; bivalent designs take 25-75 % of the peak (CIBSE Journal 11/2023)",
  },
  {
    key: "dcSharePct",
    group: "Investment",
    label: "Heat from the heat pump, at least",
    unit: "% of the year",
    min: 0,
    max: 100,
    step: 1,
    source: BEW,
    note: "buildings join while the heat pump the data center's heat allows still gives this share of the network's yearly heat; BEW: 75 % for a new network",
  },
  {
    key: "heatPrice",
    group: "Operation",
    label: "Heat price to the buildings",
    unit: "€/MWh",
    min: 0,
    max: 300,
    step: 1,
    source: {
      label: "AGFW price platform via ZfK, Fernwärmepreise 2026",
      url: "https://www.zfk.de/energie/waermewende/fernwaermepreise-2026-klarer-trend-erkennbar",
    },
    note: "net, all in; the AGFW average was 15.7 ct/kWh with VAT on 1 January 2026",
  },
  {
    key: "aptMwh",
    group: "Operation",
    label: "Heat of one apartment",
    unit: "MWh/a",
    min: 1,
    max: 50,
    step: 0.5,
    source: ESTIMATE,
    note: "heating and hot water, ~70 m² × 130 kWh/(m²·a); a building's apartments are its heat ÷ this when its data gives none",
  },
  {
    key: "elecPrice",
    group: "Operation",
    label: "Electricity price",
    unit: "€/MWh",
    min: 0,
    max: 500,
    step: 1,
    source: { label: "BDEW-Strompreisanalyse Oktober 2026", url: "https://www.bdew.de/media/documents/BDEW_Strompreisanalyse_102026_1.pdf" },
    note: "industry, 160 MWh-20 GWh a year, medium voltage, net",
  },
  {
    key: "wasteHeatPrice",
    group: "Operation",
    label: "Price paid for the waste heat",
    unit: "€/MWh",
    min: 0,
    max: 60,
    step: 1,
    source: FFM,
    note: "free in the Frankfurt study; Stockholm pays ~20 €/MWh, for heat at network temperature",
  },
  {
    key: "gasPrice",
    group: "Operation",
    label: "Gas price (peak boiler)",
    unit: "€/MWh",
    min: 0,
    max: 200,
    step: 1,
    source: FFM,
    note: "without the CO₂ price; the Frankfurt study used 80 €/MWh for 2025",
  },
  { key: "boilerEffPct", group: "Operation", label: "Peak boiler efficiency", unit: "%", min: 70, max: 110, step: 1, source: KWW },
  {
    key: "co2Price",
    group: "Operation",
    label: "CO₂ price, first year",
    unit: "€/t",
    min: 0,
    max: 300,
    step: 1,
    source: {
      label: "Deutscher Bundestag, BEHG corridor 55-65 €/t (2026)",
      url: "https://www.bundestag.de/dokumente/textarchiv/2026/kw42-de-brennstoffemissionshandelsgesetz-1223608",
    },
    note: `on the boiler's gas, ${CO2.gas} t CO₂ per MWh of gas (UBA, by its lower heating value), burnt at the peak boiler's efficiency above`,
  },
  {
    key: "co2Rise",
    group: "Operation",
    label: "CO₂ price rise",
    unit: "€/(t·a)",
    min: 0,
    max: 30,
    step: 1,
    source: ESTIMATE,
    note: "the Frankfurt study +15 €/a; EU ETS2 from 2028",
  },
  {
    key: "hpOmPct",
    group: "Operation",
    label: "Heat pump O&M, fixed",
    unit: "%/a",
    min: 0,
    max: 6,
    step: 0.1,
    source: KWW,
    note: "of its investment a year; DEA's is much lower",
  },
  { key: "hpOmVar", group: "Operation", label: "Heat pump O&M, per MWh", unit: "€/MWh", min: 0, max: 10, step: 0.1, source: KWW },
  {
    key: "netOmPerMw",
    group: "Operation",
    label: "Network O&M",
    unit: "€/(MW·a)",
    min: 0,
    max: 10_000,
    step: 50,
    source: DEA_NET,
    note: "per MW of the network's peak (its largest hour)",
  },
  { key: "netOmVar", group: "Operation", label: "Network O&M, per MWh", unit: "€/MWh", min: 0, max: 10, step: 0.1, source: DEA_NET, note: "per MWh delivered" },
  {
    key: "substationOm",
    group: "Operation",
    label: "Substation O&M",
    unit: "€/a each",
    min: 0,
    max: 1000,
    step: 10,
    source: KWW,
    note: "KWW Tab 40: 170 €/a at 100 kW",
  },
  { key: "meteringEur", group: "Operation", label: "Metering and billing", unit: "€/a each", min: 0, max: 600, step: 10, source: ESTIMATE },
  {
    key: "pumpHeadBar",
    group: "Operation",
    label: "Network pumps' fixed head",
    unit: "bar",
    min: 0,
    max: 5,
    step: 0.1,
    source: ESTIMATE,
    note: "the station's exchangers and the farthest house substation with its control valve; added to the longest path's pipes, supply and return, at the DN table's 150 Pa/m",
  },
  {
    key: "pumpEffPct",
    group: "Operation",
    label: "Network pumps' efficiency",
    unit: "%",
    min: 30,
    max: 90,
    step: 1,
    source: ESTIMATE,
    note: "pump and motor, electricity to water; the pumps' electricity is each hour's flow × the head ÷ this",
  },
  {
    key: "groundC",
    group: "Operation",
    label: "Ground temperature",
    unit: "°C",
    min: 0,
    max: 20,
    step: 1,
    source: ESTIMATE,
    note: "the pipes' heat losses scale with their mean temperature above it",
  },
  {
    key: "demandDeclinePct",
    group: "Operation",
    label: "Demand decline (renovation)",
    unit: "%/a",
    min: 0,
    max: 3,
    step: 0.1,
    source: KWW,
    note: "KWW Tab 55: 1.3 %/a observed 2016-2025",
  },
  {
    key: "discountPct",
    group: "Money",
    label: "Discount rate",
    unit: "%/a",
    min: 0,
    max: 15,
    step: 0.1,
    source: KWW_DOC,
    note: "a nominal rate: the cash flows are in each year's euros and rise with the prices (the price rise below); KWW 5 %; DEA 3.5 %; the Frankfurt study 3 % (9 % as a sensitivity)",
  },
  {
    key: "escalationPct",
    group: "Money",
    label: "Price rise (heat, power, gas, O&M)",
    unit: "%/a",
    min: 0,
    max: 6,
    step: 0.1,
    source: ESTIMATE,
    note: "the Frankfurt study 3 %/a",
  },
  { key: "years", group: "Money", label: "Horizon", unit: "years", min: 5, max: 40, step: 1, source: ESTIMATE },
  {
    key: "pipeLife",
    group: "Money",
    label: "Pipes' life",
    unit: "years",
    min: 20,
    max: 60,
    step: 1,
    source: DEA_NET,
    note: "DEA 45 (30-60); also the pumps' and the grid connection's",
  },
  { key: "hpLife", group: "Money", label: "Heat pump's life", unit: "years", min: 10, max: 40, step: 1, source: DEA_HP },
  { key: "substationLife", group: "Money", label: "Substations' life", unit: "years", min: 10, max: 40, step: 1, source: KWW },
];
export const BEW_SOURCE = BEW;
export const BEW_M4_SOURCE = BEW_M4;

const BOILER_LIFE = 30; // KWW Tab 20
const PA_PER_M = 150; // the DN table's specific pressure loss (PIPE_SOURCE: Nussbaumer & Thalmann 2017), the pumps' head per metre
const SUBSTATION_B = 0.37917; // KWW Tab 40: I = a · P_kW^b
const BEW_MIN_SHARE = 0.75; // BEW: a new network needs this share of renewable or waste heat
const BEW_MIN_BUILDINGS = 17; // BEW: more than 16 buildings, or
const BEW_MAX_SMALL_DWELLINGS = 100; // more than 100 dwellings
const BEW_M4_YEARS = 10;

/** The BEW Modul 4 operating aid per MWh of the heat pump's heat (€), at its seasonal COP: (5.5 − (6.8 − 17/SCOP) ·
 * 0.75) ct/kWh of heat, i.e. ·SCOP/(SCOP−1) per kWh of waste heat, at most 9.2 ct per kWh of waste heat; 0 below SCOP 2.5. */
export function bewOperatingEurPerMwh(scop: number): number {
  if (scop < 2.5) return 0;
  const perHeat = 5.5 - (6.8 - 17 / scop) * 0.75;
  return 10 * Math.max(0, Math.min(perHeat, 9.2 * (1 - 1 / scop)));
}

/** The station's COP in words: "seasonal COP 3,9" (the year's heat ÷ electricity: the COP moves with the supply on
 * the heating curve), or that the source feeds in directly (cop 0: no heat pump runs). */
export const copLabel = (cop: number) => (cop > 0 ? `seasonal COP ${fmt(cop, 1)}` : "direct, no heat pump");

/** The heat-pump heat the data center's heat allows for a network designed for `supplyC`/`returnC`, its supply on the
 * heating curve over the typical year (quickAnalysis.ts yearSupply): the largest hour of q × COP/(COP − 1), which is
 * the coldest hour's (the highest supply, the lowest COP). The plan's and the economics' ceiling. */
export const capacityOnCurve = (src: Site["source"], supplyC: number, returnC: number) =>
  src ? ceilingKw(flatDc(wasteKw(src), src.temp_c), yearSupply(supplyC, returnC)) : 0;

/** The network's typical year hour by hour (kW, 8,760 values: YEAR_TIMES). */
export interface YearHours {
  demandKw: number[]; // the buildings'
  lossKw: number; // the hot pipes', every hour
  hpKw: number[]; // heat from the heat pump (or the heat exchanger) into the network
  hpElecKw: number[];
  boilerKw: number[];
  takenKw: number[]; // the data center's heat the heat pump takes
  usableKw: number; // what it could take every hour: the data center's heat (the heat used) less the transmission line's loss
  cop: number; // the year's: the heat pump's heat ÷ its electricity (0: it never ran)
}

/** The network's year, hourly on the typical year (MWh, kW). */
export interface HeatYear {
  soldMwh: number; // the buildings' demand: all of it is sold (the heat pump's and the boiler's heat)
  lossMwh: number; // the hot pipes' losses, made too
  hpMwh: number; // heat from the heat pump (or the heat exchanger)
  hpElecMwh: number;
  boilerMwh: number; // heat from the peak boiler
  boilerKw: number; // its largest hour
  sourceMwh: number; // the data center's heat taken
  wasteMwh: number; // the data center's heat offered
  scop: number;
  hours: YearHours;
}

/** The chosen buildings' typical year with the losses (kW, constant) through a heat pump of `hpKw` and no tank; the
 * transmission line's loss comes off the data center's heat; the supply follows the heating curve (yearSupply), so the
 * COP is each hour's. No start-up lag (hpTauH 0): the station runs all year and
 * the network's water buffers its ramps, as network.ts's share check assumes. The buildings' profiles are summed as
 * they are: each is a typical building's hour, not its design load, so their sum is the network's hour (the boiler's
 * largest hour, and the pipes are sized for it too). A source hot enough for the exchanger alone (no heat pump) gives at
 * most the station's size too: the station and the transmission line are sized and costed for `hpKw`. */
export function heatYear(site: Site, chosen: string[], hpKw: number, lossKw: number, transLossKw: number): HeatYear {
  const ids = new Set(chosen);
  const entries = demandEntries(site).filter((e) => ids.has(e.id) && isIncluded(e.settings));
  const kw = new Array<number>(HOURS).fill(0);
  for (const e of entries) {
    const b = buildingKw(e.settings);
    for (let h = 0; h < HOURS; h++) kw[h] += b[h];
  }
  const hottest = hottestIncluded(entries);
  const src = site.source;
  const wasteMwh = (wasteKw(src) * HOURS) / 1000;
  const zero = new Array<number>(HOURS).fill(0);
  if (!src || !hottest)
    return {
      ...{ soldMwh: 0, lossMwh: 0, hpMwh: 0, hpElecMwh: 0, boilerMwh: 0, boilerKw: 0, sourceMwh: 0, wasteMwh, scop: 0 },
      hours: { demandKw: kw, lossKw: 0, hpKw: zero, hpElecKw: zero, boilerKw: zero, takenKw: zero, usableKw: 0, cop: 0 },
    };
  // the supply hour by hour on the heating curve (quickAnalysis.ts yearSupply): the COP moves with it
  const supply = yearSupply(hottest.supplyTemp, hottest.returnTemp);
  // matchHeat's direct path has no limit of its own (hpCapacity is the heat pump's): in the hours the source feeds in
  // directly the heat offered is cut to the station
  const offered = wasteKw(src) - transLossKw;
  const dc = flatDc(offered, src.temp_c);
  const direct = supply.map((s) => stationCapacity(offered, src.temp_c, s).direct);
  dc.q = dc.q.map((q, h) => (direct[h] ? Math.min(q, hpKw) : q));
  const o = { ...DEFAULT_OPTIONS, ...RECOVERED, recovery: "auto" as const, hpCapacity: hpKw, tankKwh: 0, hpTauH: 0 };
  const r = matchHeat(
    dc.q,
    dc.t,
    kw.map((x) => x + lossKw),
    supply,
    o,
    1,
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / 1000;
  const hpMwh = r.totals.deliveredMwh;
  return {
    soldMwh: sum(kw),
    lossMwh: (lossKw * HOURS) / 1000,
    hpMwh,
    hpElecMwh: r.totals.hpElecMwh,
    boilerMwh: r.totals.unmetMwh,
    boilerKw: r.unmet.reduce((a, b) => Math.max(a, b), 0),
    sourceMwh: sum(r.drawn),
    wasteMwh,
    scop: r.totals.hpElecMwh > 0 ? hpMwh / r.totals.hpElecMwh : 0,
    hours: {
      demandKw: kw,
      lossKw,
      hpKw: r.direct.map((d, h) => d + r.hp[h]),
      hpElecKw: r.hpElec,
      boilerKw: r.unmet,
      takenKw: r.drawn,
      usableKw: (direct.every(Boolean) ? Math.min(offered, hpKw) : offered) * o.hexEff,
      cop: r.totals.spf,
    },
  };
}

/** A pipe with its size and cost. */
export interface SizedPipe {
  pipe: Pipe;
  dn: PipeDn & { over: boolean; n: number }; // n pipes of it side by side (1 unless above the largest DN)
  kw: number; // what it is sized for: its largest hour, at least its design peak (the transmission line: the data center's heat the heat pump draws)
  eurPerM: number; // one pipe's (pair's)
  eur: number;
  lossW: number;
}

export type Asset = "hp" | "pipes" | "substations" | "boiler" | "soft";

/** One line of the investment. */
export interface CostLine {
  key: string;
  label: string;
  detail: string;
  eur: number;
  asset: Asset; // its life (soft costs: no residual value, not renewed)
  eligible: boolean; // for the BEW grant
}

export interface CashFlow {
  year: number;
  revenue: number;
  energy: number; // electricity, gas, CO₂, waste heat
  om: number;
  subsidy: number; // BEW Modul 4
  reinvest: number;
  residual: number;
  net: number;
  disc: number;
  cum: number; // cumulative discounted, from year 0
}

export interface Economics {
  supplyC: number;
  returnC: number;
  cop: number; // the seasonal COP: the year's heat-pump heat ÷ its electricity (0: fed in directly, no heat pump ran)
  capacityKw: number; // what the data center's heat allows
  hpKw: number; // the station's size
  boilerKw: number;
  dcShare: number; // of the heat made (sold + lost), from the heat pump (the data center's heat and its electricity), 0..1
  boilerShare: number; // from the gas peak boiler, 0..1
  pipes: SizedPipe[];
  lines: CostLine[];
  capex: number; // before the grants
  grant: number; // BEW Modul 2 + Modul 1
  gap: number; // the funding gap: what the NPV lacks without BEW (0: the network pays without it); BEW aid closes at most it
  bewWhy: string | null; // why no BEW grant
  invest: number; // after the grants
  year: HeatYear;
  lossShare: number; // of the heat made
  flows: CashFlow[]; // year 0 first
  npv: number;
  breakEven: number | null; // the first year the cumulative discounted cash flow is ≥ 0
  payback: number | null; // simple: the years until the undiscounted flows (no residual value) have paid the investment back; null: not within the horizon
  lcoh: number; // €/MWh sold in the first year's prices, rising as the heat price: the heat price at which the NPV is 0
  m4EurPerMwh: number; // the BEW operating aid's rate per MWh of heat-pump heat (0: none)
  m4PaidEurPerMwh: number; // what of it is paid in year 1: at most 90 % of the heat pump's electricity cost
  pumpMwh: number; // the network pumps' electricity in the typical year
  apartments: number; // who pays the heat price: a building's houses, or its heat ÷ aptMwh (at least 1)
}

/** VAT on district heat paid by a household (UStG § 12 (1): 19 %, back from 7 % since 1 March 2024). */
export const HEAT_VAT_PCT = 19;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** What to say when pipes carry more than the largest DN does at their ΔT (pipeDn's `over`): they are priced as
 * pipes of that size side by side (the most of them a run needs); null when every pipe fits. `dtOf`: a pipe's ΔT (K). */
export function pipesOver(pipes: SizedPipe[], dtOf: (x: SizedPipe) => number = () => 30): string | null {
  const over = pipes.filter((x) => x.dn.over);
  if (!over.length) return null;
  const worst = over.reduce((a, x) => (x.kw / dtOf(x) > a.kw / dtOf(a) ? x : a));
  const m = over.reduce((a, x) => a + x.pipe.m, 0);
  const cap = (worst.dn.kwAt30K * dtOf(worst)) / 30;
  return `Pipes too small: ${fmt(m)} m carry more than the largest size, DN ${worst.dn.dn}, does (up to ${fmt(worst.kw)} kW against ${fmt(cap)} kW). They are priced as ${worst.dn.n} pipes of that size side by side (cost and heat loss × ${worst.dn.n}); a larger ΔT may cost less.`;
}

/** The simple payback, years: when the undiscounted yearly flows have summed to the investment (within that year by
 * its share), without what is left of the plant at the end; null when they never do within the horizon. Not the
 * investment ÷ year 1's net: that year holds the ten-year BEW operating aid, so a lower heat price shortened it. */
export function simplePayback(flows: CashFlow[], invest: number): number | null {
  let open = invest;
  for (const f of flows.slice(1)) {
    const net = f.net - f.residual;
    if (net > 0 && net >= open) return f.year - 1 + Math.max(0, open) / net;
    open -= net;
  }
  return null;
}

/** `p` with the horizon and the lives in whole years (at least 1): the cash flows are by the year, so a life of 12.5
 * years never came due while the residual value counted its renewal, and a horizon of 20.5 ran 21 years under the
 * label 20,5. */
export function wholeYears(p: NetworkParams): NetworkParams {
  const y = (x: number) => Math.max(1, Math.round(x));
  return { ...p, years: y(p.years), hpLife: y(p.hpLife), pipeLife: y(p.pipeLife), substationLife: y(p.substationLife) };
}

/** The planned network's sizes, investment, year and cash flows under `params` (wholeYears of them). */
export function networkEconomics(site: Site, net: HeatNetwork, params: NetworkParams): Economics {
  const p = wholeYears(params);
  const chosen = new Set(net.chosen);
  const sinks = site.sinks.filter((s) => chosen.has(s.id));
  const hot = demandEntries(site)
    .filter((e) => chosen.has(e.id))
    .reduce<{ supplyTemp: number; returnTemp: number } | null>((a, e) => (!a || e.settings.supplyTemp > a.supplyTemp ? e.settings : a), null);
  const supplyC = hot?.supplyTemp ?? 70;
  const returnC = hot?.returnTemp ?? 40;
  const dt = Math.max(1, supplyC - returnC);
  const src = site.source;
  // at the design supply: whether the source feeds in directly all year (no heat pump)
  const st = stationCapacity(wasteKw(src), src?.temp_c ?? 0, supplyC);
  const capacityKw = capacityOnCurve(src, supplyC, returnC);
  const hpKw = Math.min(net.hpKw, capacityKw); // the plan's (network.ts), within what this data center's heat gives

  // what a run carries in its largest hour of the typical year (its buildings' hours summed): the station sends that
  // through it, the heat pump's and the boiler's. Its design peak (the buildings' design peaks on a day at −12 °C ×
  // simultaneity, network.ts) can fall short of it: the profiles share one weather, so their hours add up in full (on
  // the example the trunk by ~9 %, a single building never); a run is sized for the larger of the two. ponytail:
  // looked for among the network's 100 largest hours (every hour for every run is ~40 ms a change of the
  // assumptions), exact while the profiles share their shape; every hour if a mix of shapes needs it
  const settings = new Map(demandEntries(site).map((e) => [e.id, e.settings]));
  const kwOf = net.chosen.map((id) => (settings.has(id) ? buildingKw(settings.get(id)!) : null));
  const H = HOURS; // a local copy for the hourly loop (vitest's imports are getters)
  const all = new Float64Array(H);
  for (const k of kwOf) if (k) for (let h = 0; h < H; h++) all[h] += k[h];
  const top = Array.from(all.keys())
    .sort((a, b) => all[b] - all[a] || a - b)
    .slice(0, 100);
  const peakHour = (served: number[]) => {
    let most = 0;
    for (const h of top) {
      let kw = 0;
      for (const b of served) kw += kwOf[b]?.[h] ?? 0;
      most = Math.max(most, kw);
    }
    return most;
  };
  const designKw = Math.max(net.peakKw, net.yearPeakKw); // the network pumps' (and the trunk's)

  // each pipe its DN; the transmission line carries the data center's warm water, the rest the network's
  const eurOf = (d: PipeDn) => (p.area === "inner_city" ? d.eurInnerCity : d.eurSuburban) * p.pipeScale;
  const hotLoss = (supplyC + returnC) / 2 - p.groundC;
  const warmLoss = (src?.temp_c ?? 0) - p.sourceDtK / 2 - p.groundC;
  const sized = (pipe: Pipe, kw: number): SizedPipe => {
    const trans = pipe.kind === "transmission";
    const dn = pipeDn(kw, trans ? p.sourceDtK : dt);
    const eurPerM = eurOf(dn);
    return { pipe, dn, kw, eurPerM, eur: eurPerM * pipe.m * dn.n, lossW: (dn.lossW * dn.n * Math.max(0, trans ? warmLoss : hotLoss) * pipe.m) / 45 }; // the table's at 55 − 10 K
  };
  const hotPipes = net.pipes.map((pipe) => (pipe.kind === "transmission" ? null : sized(pipe, Math.max(pipe.peakKw, peakHour(pipe.served)))));
  // the transmission line: the most the heat pump draws from the data center in an hour of the year. On the heating
  // curve that is not the coldest hour: on a milder day at full output the COP is higher and more of the heat is the
  // data center's (at most all of its heat)
  const hotLossKw = sum(hotPipes.map((x) => x?.lossW ?? 0)) / 1000;
  let drawKw = 0;
  const supplyYear = yearSupply(supplyC, returnC);
  if (src) {
    for (let h = 0; h < H; h++) {
      const c = stationCapacity(wasteKw(src), src.temp_c, supplyYear[h]);
      drawKw = Math.max(drawKw, Math.min(hpKw, all[h] + hotLossKw) * (c.direct ? 1 : 1 - 1 / c.cop));
    }
  }
  const pipes = net.pipes.map((pipe, i): SizedPipe => hotPipes[i] ?? sized(pipe, Math.min(drawKw, wasteKw(src))));
  const lossW = (kind: "trans" | "hot") => sum(pipes.filter((x) => (x.pipe.kind === "transmission") === (kind === "trans")).map((x) => x.lossW));
  const year = heatYear(site, net.chosen, hpKw, lossW("hot") / 1000, lossW("trans") / 1000);
  // the grid connection: the heat pump's largest hour of electricity in the year (the COP of each hour: A10)
  const elecKw = year.hours.hpElecKw.reduce((a, b) => Math.max(a, b), 0);
  // the peak boiler: the design hour (the design peak, at least the typical year's largest hour, with the hot pipes'
  // losses) less the heat pump, at least the typical year's largest hour of the boiler
  const boilerKw = Math.ceil(Math.max(year.boilerKw, designKw + lossW("hot") / 1000 - hpKw) / 10) * 10;
  // the network pumps' electricity: each hour's flow (the heat sent out ÷ ρ·cp·ΔT, ΔT the hour's supply on the heating
  // curve less the return) against the head of the longest way from the station to a building (its pipes, supply and
  // return, at the sizing's PA_PER_M, plus the fixed head), ÷ their efficiency. The pumps hold that head all year
  // (no lower head at part load: on the safe side). The data center's own loop (the transmission line) is its pumps'.
  const pathM = Math.max(0, ...net.chosen.map((_, b) => sum(net.pipes.filter((x) => x.kind !== "transmission" && x.served.includes(b)).map((x) => x.m))));
  const headPa = 2 * pathM * PA_PER_M + p.pumpHeadBar * 1e5;
  let pumpMwh = 0;
  for (let h = 0; h < H; h++)
    pumpMwh += ((year.hours.demandKw[h] + year.hours.lossKw) * headPa) / (RHO_CP * Math.max(1, supplyYear[h] - returnC) * (p.pumpEffPct / 100)) / 1000;

  const cost = (kind: Pipe["kind"]) => sum(pipes.filter((x) => x.pipe.kind === kind).map((x) => x.eur));
  const metres = (kind: Pipe["kind"]) => sum(pipes.filter((x) => x.pipe.kind === kind).map((x) => x.pipe.m));
  const substations = sum(net.pipes.filter((x) => x.kind === "service").map((x) => p.substationA * Math.max(1, x.peakKw) ** SUBSTATION_B));
  const n = sinks.length;
  const apartments = sum(
    demandEntries(site)
      .filter((e) => chosen.has(e.id))
      .map((e) => (e.settings.houses > 1 ? e.settings.houses : Math.max(1, Math.round(annualMwh(e.settings) / p.aptMwh)))),
  );
  const m = (x: number) => `${fmt(x)} m`;
  // a source hot enough for the exchanger alone (st.direct: at the design supply, so all year) needs no heat pump: the
  // station is priced as a substation of its size (KWW Tab 40's curve, the house substations', extrapolated above its
  // 500 kW), with no grid connection (elecKw 0) and no heat-pump O&M
  const station: CostLine = st.direct
    ? {
        key: "hp",
        label: "Exchanger station",
        detail: `${fmt(hpKw)} kW: ${fmt(p.substationA)} € × P_kW^0,38`,
        eur: p.substationA * Math.max(1, hpKw) ** SUBSTATION_B,
        asset: "substations",
        eligible: true,
      }
    : { key: "hp", label: "Heat-pump station", detail: `${fmt(hpKw)} kW × ${fmt(p.hpEurPerKw)} €/kW`, eur: hpKw * p.hpEurPerKw, asset: "hp", eligible: true };
  const hard: CostLine[] = [
    station,
    {
      key: "grid",
      label: "Grid connection",
      detail: `${fmt(elecKw)} kW el × ${fmt(p.gridEurPerKwEl)} €/kW`,
      eur: elecKw * p.gridEurPerKwEl,
      asset: "pipes",
      eligible: true,
    },
    {
      key: "transmission",
      label: "Transmission line",
      detail: `${m(metres("transmission"))}, data center → station`,
      eur: cost("transmission"),
      asset: "pipes",
      eligible: true,
    },
    {
      key: "distribution",
      label: "Distribution pipes",
      detail: `${m(metres("distribution"))} under the streets`,
      eur: cost("distribution"),
      asset: "pipes",
      eligible: true,
    },
    { key: "service", label: "House connections", detail: `${m(metres("service"))}, ${n} buildings`, eur: cost("service"), asset: "pipes", eligible: true },
    {
      key: "substations",
      label: "House substations",
      detail: `${n} × ${fmt(p.substationA)} € × P_kW^0,38`,
      eur: substations,
      asset: "substations",
      eligible: true,
    },
    {
      key: "pumps",
      label: "Network pumps",
      detail: `${fmt(designKw)} kW × ${fmt(p.pumpsEurPerKw)} €/kW`,
      eur: designKw * p.pumpsEurPerKw,
      asset: "pipes",
      eligible: true,
    },
    {
      key: "boiler",
      label: "Gas peak boiler",
      detail: `${fmt(boilerKw)} kW × ${fmt(p.boilerEurPerKw)} €/kW`,
      eur: boilerKw * p.boilerEurPerKw,
      asset: "boiler",
      eligible: false,
    },
  ];
  const planned = sum(hard.filter((l) => !["hp", "grid", "boiler"].includes(l.key)).map((l) => l.eur));
  const planning: CostLine = {
    key: "planning",
    label: "Planning",
    detail: `${p.planningPct} % of pipes, pumps, substations`,
    eur: (planned * p.planningPct) / 100,
    asset: "soft",
    eligible: true,
  };
  const contingency: CostLine = {
    key: "contingency",
    label: "Contingency",
    detail: `${p.contingencyPct} % of all`,
    eur: (sum([...hard, planning].map((l) => l.eur)) * p.contingencyPct) / 100,
    asset: "soft",
    eligible: true,
  };
  const study: CostLine = { key: "study", label: "Feasibility study", detail: "BEW Modul 1: half of it", eur: p.studyEur, asset: "soft", eligible: false };
  const lines = [...hard, planning, contingency, study];
  const capex = sum(lines.map((l) => l.eur));

  // BEW: new networks need ≥ 75 % waste or renewable heat and more than 16 buildings or more than 100 dwellings
  const share = year.soldMwh + year.lossMwh > 0 ? year.hpMwh / (year.soldMwh + year.lossMwh) : 0;
  const bewWhy = !p.bew
    ? "switched off"
    : n < BEW_MIN_BUILDINGS && apartments <= BEW_MAX_SMALL_DWELLINGS
      ? `only ${n} building${n === 1 ? "" : "s"} and ${fmt(apartments)} dwellings (BEW: more than 16 buildings or 100 dwellings)`
      : share < BEW_MIN_SHARE
        ? `${fmt(Math.floor(share * 1000) / 10, 1)} % of the heat from the heat pump (BEW: at least 75 %)` // floored: 74.96 % is not "75,0 %"
        : null;
  const m4Rate = !bewWhy && p.bewOperating && !st.direct ? bewOperatingEurPerMwh(year.scop) : 0;

  // the cash flows of an investment after grants `invest` and a share `aid` of the operating aid: year 0 the
  // investment, then a year of operation each
  const life: Record<Asset, number> = { hp: p.hpLife, pipes: p.pipeLife, substations: p.substationLife, boiler: BOILER_LIFE, soft: Infinity };
  const N = p.years;
  const r = p.discountPct / 100;
  const hpCapex = st.direct ? 0 : hard[0].eur; // the heat pump's O&M (none without one)
  const cashFlows = (invest: number, aid: number) => {
    const flows: CashFlow[] = [{ year: 0, revenue: 0, energy: 0, om: 0, subsidy: 0, reinvest: 0, residual: 0, net: -invest, disc: -invest, cum: -invest }];
    for (let y = 1; y <= N; y++) {
      const f = (1 + p.escalationPct / 100) ** (y - 1);
      const d = (1 - p.demandDeclinePct / 100) ** (y - 1);
      const gas = (year.boilerMwh * d) / (p.boilerEffPct / 100);
      const elec = (year.hpElecMwh + pumpMwh) * d * p.elecPrice * f;
      const energy = elec + gas * p.gasPrice * f + gas * CO2.gas * (p.co2Price + p.co2Rise * (y - 1)) + year.sourceMwh * d * p.wasteHeatPrice * f;
      const om =
        ((hpCapex * p.hpOmPct) / 100 +
          (designKw / 1000) * p.netOmPerMw +
          n * (p.substationOm + p.meteringEur) +
          ((st.direct ? 0 : year.hpMwh * p.hpOmVar) + year.soldMwh * p.netOmVar) * d) *
        f;
      // the aid: at most 90 % of the heat pump's electricity cost
      const subsidy = y <= BEW_M4_YEARS ? aid * Math.min(m4Rate * year.hpMwh * d, 0.9 * year.hpElecMwh * d * p.elecPrice * f) : 0;
      let reinvest = 0;
      let residual = 0;
      for (const l of lines) {
        const L = life[l.asset];
        if (!Number.isFinite(L) || L <= 0) continue;
        if (y % L === 0 && y < N) reinvest += l.eur * f; // renewed at the end of its life (within the horizon)
        // what is left of its last one at the end (bought in year 0, or renewed at its price then), straight-line
        const last = Math.floor(N / L) * L;
        if (y === N && p.residual && N % L) residual += l.eur * (1 - (N - last) / L) * (last ? (1 + p.escalationPct / 100) ** (last - 1) : 1);
      }
      const netY = year.soldMwh * d * p.heatPrice * f + subsidy - energy - om - reinvest + residual;
      const disc = netY / (1 + r) ** y;
      flows.push({
        year: y,
        revenue: year.soldMwh * d * p.heatPrice * f,
        energy,
        om,
        subsidy,
        reinvest,
        residual,
        net: netY,
        disc,
        cum: flows[y - 1].cum + disc,
      });
    }
    return flows;
  };
  // BEW: Modul 1 half the study. The aid for building and running it (the Modul 2 investment grant first, up to its
  // share of the eligible investment, then the operating aid of Modul 4 for what of the gap is left) is at most the
  // funding gap (the guideline's Wirtschaftlichkeitslücke, state-aid law), here what the NPV over the horizon lacks
  // without BEW: none when it pays
  const m1 = bewWhy ? 0 : study.eur / 2;
  const m2Max = bewWhy ? 0 : (sum(lines.filter((l) => l.eligible).map((l) => l.eur)) * p.bewPct) / 100;
  const none = cashFlows(capex - m1, 0);
  const gap = Math.max(0, -none[N].cum);
  const m2 = Math.min(m2Max, gap); // paid in year 0: worth its face value
  const aidPv = m4Rate ? cashFlows(capex - m1, 1)[N].cum - none[N].cum : 0; // the full operating aid's present value
  const aid = gap - m2 > 0 && aidPv > 0 ? Math.min(1, (gap - m2) / aidPv) : 0;
  const grant = m1 + m2;
  const invest = capex - grant;
  const flows = gap ? cashFlows(invest, aid) : none;
  const npv = flows[N].cum;
  const be = flows.find((x) => x.cum >= -1); // to the euro: a grant that closes the gap ends the horizon at 0
  // the heat at the heat price's rise: the LCOH compares with the first year's price (NPV = (price − LCOH) × heatPv).
  // On the flows without the gap-sized aid (Modul 1 only): the BEW grant and operating aid are sized on the heat price
  // (to close the gap at it), so with them the LCOH would just be that price
  const pv = (fn: (x: CashFlow) => number) => sum(none.map((x) => fn(x) / (1 + r) ** x.year));
  const grow = (1 - p.demandDeclinePct / 100) * (1 + p.escalationPct / 100);
  const heatPv = sum(none.slice(1).map((x) => (year.soldMwh * grow ** (x.year - 1)) / (1 + r) ** x.year));
  const costPv = capex - m1 + pv((x) => x.energy + x.om + x.reinvest - x.residual - x.subsidy);
  return {
    supplyC,
    returnC,
    cop: year.scop,
    capacityKw,
    hpKw,
    boilerKw,
    dcShare: share,
    boilerShare: year.soldMwh + year.lossMwh > 0 ? year.boilerMwh / (year.soldMwh + year.lossMwh) : 0,
    pipes,
    lines,
    capex,
    grant,
    gap,
    bewWhy,
    invest,
    year,
    lossShare: year.soldMwh + year.lossMwh > 0 ? year.lossMwh / (year.soldMwh + year.lossMwh) : 0,
    flows,
    npv,
    breakEven: be ? be.year : null,
    payback: simplePayback(flows, invest),
    lcoh: heatPv > 0 ? costPv / heatPv : 0,
    m4EurPerMwh: m4Rate * aid,
    m4PaidEurPerMwh: year.hpMwh > 0 ? (flows[1]?.subsidy ?? 0) / year.hpMwh : 0,
    pumpMwh,
    apartments,
  };
}

// water's heat per m³ and K at the network's 40-70 °C (985 kg/m³ × 4.18 kJ/(kg·K)): flow → speed in the pipes
const RHO_CP = 4.12e6;

/** One day of the typical year hour by hour (24 values each, kW but outdoorC). */
export interface DayHours {
  day: number; // of the year, 0 = 1 January
  first: number; // its first hour of the year: its midnight on Frankfurt's clock
  outdoorC: number[];
  demandKw: number[]; // the buildings'
  lossKw: number; // the hot pipes', every hour
  hpKw: number[];
  boilerKw: number[];
  spareKw: number[]; // the data center's heat the heat pump could still have taken
}

/** The plan's typical year for the time view: computed once per plan and economics, read hour by hour with hourAt. */
export interface NetworkHours {
  ids: string[]; // the buildings supplied (HeatNetwork.chosen)
  kw: Float64Array[]; // each one's demand per hour, in that order
  outdoorC: number[]; // per hour of the year
  year: YearHours;
  dcKw: number; // the data center's heat, every hour (held flat)
  months: { demand: number[]; loss: number[]; hp: number[]; boiler: number[]; hpElec: number[]; taken: number[]; spare: number[] }; // MWh, January first
  winter: DayHours; // the coldest day
  summer: DayHours; // the warmest (in July)
  pipes: { served: number[]; areaM2: number; dtK: number; transmission: boolean }[]; // HeatNetwork.pipes's order: the buildings downstream, the inner cross-section, ΔT
}

/** The plan at one hour of the typical year. */
export interface NetworkHour {
  h: number; // 0..8759
  time: number; // unix s (YEAR_TIMES[h]: 2025 stands for the typical year)
  outdoorC: number;
  buildingKw: number[]; // each supplied building's demand (HeatNetwork.chosen's order)
  pipes: { kw: number; velocity: number }[]; // HeatNetwork.pipes's order: the heat it carries (the buildings downstream; the transmission line the data center's heat taken) and its water's speed, m/s
  demandKw: number; // the buildings'
  lossKw: number;
  hpKw: number;
  hpElecKw: number;
  boilerKw: number;
  dcKw: number; // the data center's heat
  takenKw: number; // of it, through the heat pump
  spareKw: number; // what the heat pump could still have taken
}

/** The plan's typical year hour by hour from its economics' year: the per-hour reads of hourAt and the summaries. A
 * pipe carries at most what it is sized for (networkEconomics: its largest hour), so its water at most its DN's speed. */
export function networkHours(site: Site, net: HeatNetwork, econ: Economics, p: NetworkParams): NetworkHours {
  const settings = new Map(demandEntries(site).map((e) => [e.id, e.settings]));
  const kw = net.chosen.map((id) => (settings.has(id) ? buildingKw(settings.get(id)!) : new Float64Array(HOURS)));
  const y = econ.year.hours;
  const out = yearOutdoor();
  const spare = y.takenKw.map((t) => Math.max(0, y.usableKw - t));
  const mwh = (xs: number[]) => perMonth(YEAR_TIMES, xs, 1).map((x) => x / 1000);
  // a day on Frankfurt's clock, as the demand's profiles (networkView.ts atHour): from its midnight there
  const day = (d: number): DayHours => {
    const first = atHour(d, 0);
    const hs = Array.from({ length: 24 }, (_, i) => (first + i) % HOURS);
    return {
      day: d,
      first,
      outdoorC: hs.map((h) => out[h]),
      demandKw: hs.map((h) => y.demandKw[h]),
      lossKw: y.lossKw,
      hpKw: hs.map((h) => y.hpKw[h]),
      boilerKw: hs.map((h) => y.boilerKw[h]),
      spareKw: hs.map((h) => spare[h]),
    };
  };
  const daily = Array.from({ length: HOURS / 24 }, (_, d) => {
    let sum = 0;
    for (let i = 0, first = atHour(d, 0); i < 24; i++) sum += out[(first + i) % HOURS];
    return sum;
  });
  const coldest = daily.indexOf(Math.min(...daily));
  const warmest = daily.indexOf(Math.max(...daily));
  const dtNet = Math.max(1, econ.supplyC - econ.returnC);
  return {
    ids: net.chosen,
    kw,
    outdoorC: out,
    year: y,
    dcKw: wasteKw(site.source),
    months: {
      demand: mwh(y.demandKw),
      loss: mwh(y.demandKw.map(() => y.lossKw)),
      hp: mwh(y.hpKw),
      boiler: mwh(y.boilerKw),
      hpElec: mwh(y.hpElecKw),
      taken: mwh(y.takenKw),
      spare: mwh(spare),
    },
    winter: day(coldest),
    summer: day(warmest),
    pipes: econ.pipes.map((x, i) => ({
      served: net.pipes[i].served,
      areaM2: (x.dn.n * Math.PI * (x.dn.innerMm / 1000) ** 2) / 4,
      dtK: x.pipe.kind === "transmission" ? p.sourceDtK : dtNet,
      transmission: x.pipe.kind === "transmission",
    })),
  };
}

/** The plan at hour `h` of the typical year (0..8759, wrapped): a few thousand additions, for an animation frame. */
export function hourAt(x: NetworkHours, h: number): NetworkHour {
  h = ((Math.round(h) % HOURS) + HOURS) % HOURS;
  const y = x.year;
  const buildingKw = x.kw.map((k) => k[h]);
  const pipes = x.pipes.map((pp) => {
    let kw = pp.transmission ? y.takenKw[h] : 0;
    if (!pp.transmission) for (const b of pp.served) kw += buildingKw[b];
    return { kw, velocity: pp.areaM2 > 0 ? (kw * 1000) / (RHO_CP * pp.dtK * pp.areaM2) : 0 };
  });
  return {
    h,
    time: YEAR_TIMES[h],
    outdoorC: x.outdoorC[h],
    buildingKw,
    pipes,
    demandKw: y.demandKw[h],
    lossKw: y.lossKw,
    hpKw: y.hpKw[h],
    hpElecKw: y.hpElecKw[h],
    boilerKw: y.boilerKw[h],
    dcKw: x.dcKw,
    takenKw: y.takenKw[h],
    spareKw: Math.max(0, y.usableKw - y.takenKw[h]),
  };
}
