/** Buildings with their heat demand (the Wärmeatlas Hessen and the open atlases of app/sources/), read from the local
 * imports one map box at a time. */
import { getJson } from "./http";

/** One building of GET /api/district/buildings (kWh/a: modelled useful heat, 2020 unless named). */
export interface WaermeatlasBuilding {
  id: number;
  lat: number;
  lon: number;
  use: string | null; // ALKIS use, e.g. "Wohngebäude", "Bürogebäude"
  type: string | null; // energy type: EFH, RH, MFH, GMH (residential) or a non-residential class
  age: string | null; // most likely construction-age class
  age_share: number | null; // its probability
  area_m2: number | null; // heated floor area
  heating_kwh: number | null;
  hot_water_kwh: number | null;
  total_kwh: number | null;
  heating_2030_kwh: number | null; // moderate renovation
  heating_2045_kwh: number | null;
  outline: [number, number][] | null; // [lat, lon] ring
  source?: string; // the import it comes from ("waermeatlas", "nrw", …): its id is unique within it only
}

export interface WaermeatlasBox {
  buildings: WaermeatlasBuilding[];
  truncated: boolean; // more buildings in the box than the cap: the smallest were left out
  sources?: Record<string, string>; // each source in the box: its credit line
}

/** The buildings in a box (south, west, north, east in degrees). 400 "Zoom in" above 2 × 2 km, 404 before the import. */
export const fetchBuildings = (box: [number, number, number, number]) =>
  getJson<WaermeatlasBox>(`/api/district/buildings?bbox=${box.map((v) => v.toFixed(6)).join(",")}`, "Heat demand not loaded");

/** One street segment of GET /api/district/heat-lines with its heat line density (Wärmeliniendichte). */
export interface HeatLine {
  id: number;
  name: string | null;
  kind: string | null; // ALKIS class, e.g. "Gemeindestraße"
  length_m: number | null;
  mwh_per_m: number; // the useful heat of the buildings its source assigns to it, per m of street, MWh/(m·a)
  mwh: number | null; // their useful heat, MWh/a
  line: [number, number][][]; // its parts, each [lat, lon] points
  source?: string; // the import it comes from: its id is unique within it only
}

export interface HeatLineBox {
  lines: HeatLine[];
  truncated: boolean; // more segments in the box than the cap: the thinnest were left out
  sources?: Record<string, string>; // each source in the box: its credit line
}

/** The street segments with heat in a box (south, west, north, east). 400 "Zoom in" above 2 × 2 km, 404 before the import. */
export const fetchHeatLines = (box: [number, number, number, number]) =>
  getJson<HeatLineBox>(`/api/district/heat-lines?bbox=${box.map((v) => v.toFixed(6)).join(",")}`, "Heat line density not loaded");

/** One reported waste heat potential of GET /api/district/heat-sources (Plattform für Abwärme, § 17 EnEfG, CC BY 4.0). */
export interface HeatSource {
  id: number;
  company: string | null;
  site: string | null;
  street: string | null;
  plz: string | null;
  city: string | null;
  name: string | null; // the potential, e.g. "Kühlturm"
  mwh: number | null; // heat a year
  max_kw: number | null;
  temp_c: number | null; // mean temperature
  temp_range: string | null; // "25 - 60 °C", ">=110 °C"
  hours_per_day: number | null;
  weekend: boolean | null;
  availability: string | null;
  predictable: boolean | null;
  control: string | null;
  note: string | null;
  months_mwh: (number | null)[] | null; // twelve, January first
  lat: number;
  lon: number;
  geo: "address" | "postcode"; // placed at its address, or only at its postcode and town
}

export interface HeatSourceBox {
  sources: HeatSource[];
  truncated: boolean;
}

/** The waste heat sources in a box (at most 40 × 40 km). 400 "Zoom in" above, 404 before scripts/import_pfa.py has run. */
export const fetchHeatSources = (box: [number, number, number, number]) =>
  getJson<HeatSourceBox>(`/api/district/heat-sources?bbox=${box.map((v) => v.toFixed(6)).join(",")}`, "Waste heat sources not loaded");

/** A data center drawn as a labelled marker on the Site map (built in, or one of GET /api/district/examples). */
export interface ExampleDataCenter {
  name: string;
  address: string;
  lat: number;
  lon: number;
  heatKw: number; // maximum waste heat ≈ IT capacity
  basis: string; // where heatKw comes from
  source: string; // URL
  buildings?: [number, number][][]; // the building outline(s) from OpenStreetMap (lat, lon), drawn under the marker
  appDataset?: boolean; // one of the app's own datasets placed on the map, drawn as an outline
  labelLeft?: boolean; // label on the left of the marker, where the right side would cover a neighbour's label
}

/** The machine-local example data centers (`_local/map_examples.json` of the data directory); [] when there is none. */
export const fetchMapExamples = () => getJson<ExampleDataCenter[]>("/api/district/examples", "Map examples not loaded");
