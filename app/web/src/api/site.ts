/** Site (site.json): the data center's building on the map, the heat source, the heat sinks and per-page settings. */
import { getJson, putJson, query, scoped, type StructureScope } from "./http";

/** The district's heat-demand generator settings (site.json `district`; lib/demand.ts uses them). */
export interface DistrictSettings {
  houses: number;
  kwhPerHouse: number; // annual heat demand of one house (heating + hot water), kWh/a
  heatingLimit: number; // °C: no space heating above this daily mean outdoor temperature
  dhwShare: number; // 0..1, hot water share of the annual demand
  morningPeak: number; // 0..1.5, weight of the morning peak in the daily heating curve
  eveningPeak: number; // 0..1.5, weight of the evening peak
  nightSetback: number; // 0..1, share the heating is turned down at night (22-5 h)
  weekendFactor: number; // demand on weekends relative to weekdays
  supplyTemp: number; // °C, district network supply (what the heat must reach)
  returnTemp: number; // °C, network return
  // Drawn on the typical-day chart: 48 half-hourly points (older saves: 24 hourly), replacing the parametric curve.
  // Only their shape counts here; the height is kwhPerHouse x dhwShare (typicalDayKw / drawDay convert).
  heatingDay?: number[];
  hotWaterDay?: number[];
  included?: boolean; // per heat sink: counted in the district total (default true)
  profile?: string; // the shape of its profile: a standard profile's id (lib/profilePresets.ts); none: the curves above
}

/** The user's choice (site.json `outdoor`): the data's column (else synthetic), always synthetic, or Open-Meteo. */
export type OutdoorChoice = "data" | "synthetic" | "open-meteo";

/** What a variable is (kind) and how sure the marking is, set on the Physical structure page or by the assistant. */
export interface PidNote {
  kind?: "sensor" | "setpoint" | "actuator" | "meter" | "it_load" | "weather" | "time" | "calculated" | "status" | null;
  confidence?: "sure" | "likely" | "unsure" | null;
  note?: string;
  group?: PidGroup | null; // this variable stands for a group of others: a mark, no values are computed
}

/** An area of the P&ID shown as a view of its own, with its own picture inside (fractions of the P&ID). */
export interface PidView {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  show?: "auto" | "box" | "sheet" | "picture"; // its level of detail (default auto: a box when small, its picture zoomed in)
}

export interface PidGroup {
  method: "mean" | "sum" | "min" | "max";
  members: string[];
}

export interface HeatPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  temp_c: number;
  power_kw: number;
  outline?: [number, number][] | null; // building outline, or the drawn area
  area?: boolean; // a whole district as one heat sink
  demand?: Partial<DistrictSettings> | null; // heat sink: its heat-demand generator settings
  utilization?: number | null; // the data center's IT utilization on average, 0..1 (missing: 1, full load)
  idle_share?: number | null; // the data center's power when idle, share of its capacity (missing: IDLE_SHARE)
  heat_used_share?: number | null; // the data center's: share of its waste heat that is used, 0..1 (missing: 1)
}

export interface Site {
  building: { name: string; osm_id: number | null; outline: [number, number][] } | null;
  source: HeatPoint | null;
  sinks: HeatPoint[];
  pid_layout?: Record<string, { x: number; y: number; tag: string }>;
  /** what each variable is and how sure, as marked on the P&ID (structure/notes.ts) */
  pid_notes?: Record<string, PidNote>;
  pid_views?: PidView[];
  hex_option?: "condenser" | "hall" | "liquid";
  district?: Partial<DistrictSettings> | null; // heat-demand generator settings
  heat_source_map?: Record<string, unknown> | null; // Heat distribution: which columns are the DC heat source (lib/sourceMap.ts)
  outdoor?: OutdoorChoice; // Heat demand: where the outdoor temperature comes from (default "data")
  heat_parts?: Record<string, boolean> | null; // Heat distribution: which parts are on, {hex, hp, tank} (pages/heat/parts.ts)
  heat_components?: Record<string, string> | null; // Heat distribution: the component replacing a part's formula (pages/heat/partComponents.ts)
  twin_model?: string | null; // the trained model this structure's part runs in Heat Matching (each structure its own site.json)
  network_station?: { lat: number; lon: number } | null; // Site map: the heat network's HP station placed by hand (HeatNetwork.tsx)
}

/** Hourly outdoor temperature at the site (Open-Meteo, cached by the backend). */
export interface Weather {
  lat: number;
  lon: number;
  start: string;
  end: string;
  source: string;
  times: number[]; // unix seconds, hourly
  temperature: number[]; // °C
}

export const fetchSite = (datasetId: string, scope?: StructureScope) =>
  getJson<Site>(`/api/datasets/${datasetId}/site${query(scoped(scope))}`, "Failed to load site");

export const saveSite = (datasetId: string, site: Site, scope?: StructureScope) =>
  putJson<Site>(`/api/datasets/${datasetId}/site${query(scoped(scope))}`, site, "Failed to save site");

/** Read-modify-write of the whole site (last writer wins), so a page changes only its own fields. `scope` heat: the
 * heat distribution's structure (its own layout, notes and views). */
export async function updateSite(datasetId: string, fn: (s: Site) => Site, scope?: StructureScope): Promise<Site> {
  return saveSite(datasetId, fn(await fetchSite(datasetId, scope)), scope);
}

/** One OpenStreetMap way: a road, a path (footway, cycleway, track, pedestrian area), or a road's sidewalk or crossing,
 * which OSM maps as ways of their own beside and across it (the heat network leaves those out: osm.ts streetKind). */
export interface StreetWay {
  kind: "road" | "path" | "sidewalk" | "crossing";
  line: [number, number][]; // [lat, lon] points; ways meet at a shared point
}

/** The streets and paths around a site (an example's streets.json, OpenStreetMap): where its heat network runs. */
export interface Streets {
  about: string;
  source: string; // with the licence: © OpenStreetMap contributors, ODbL
  bbox: [number, number, number, number]; // south, west, north, east
  ways: StreetWay[];
}

/** The dataset's stored streets; throws (404) when it has none: then osm.ts streetsIn fetches them on a click. */
export const fetchStreets = (datasetId: string) => getJson<Streets>(`/api/datasets/${datasetId}/site/streets`, "Failed to load the streets");

/** Hourly temperature at the site for start..end (YYYY-MM-DD): only the coordinates and dates go to Open-Meteo. */
export const fetchOpenMeteo = (datasetId: string, start: string, end: string) =>
  getJson<Weather>(`/api/datasets/${datasetId}/weather/open-meteo${query({ start, end })}`, "Failed to load the Open-Meteo temperature");
