/**
 * The Site map's Wärmeatlas layer, pure parts: is the view small enough to load, the colour of a building by its
 * annual heat demand (and the legend), its tooltip, and a building as a heat sink of the site.
 */
import type { HeatPoint, Site, WaermeatlasBuilding } from "../../api";
import { fmt } from "../../lib/format";
import { escapeHtml } from "./html";
import { profileFor } from "./siteEdits";

export const MAX_BOX_KM = 2; // as WAERMEATLAS_MAX_BOX_KM in backend/core/limits.py
export const ATTRIBUTION = "Wärmebedarf © LEA Hessen (Wärmeatlas Hessen), modelled useful heat 2020";
const KM_PER_DEG = 111.32;
// a rough peak for the bubble size until the demand model computes the real one from the profile
const FULL_LOAD_HOURS = 2000;
// "Add all in view" adds at most this many (the biggest first): every sink is one row and one hourly demand profile
// ponytail: a fixed cap; raise it once the demand model has been timed with that many sinks
export const MAX_ADD_ALL = 200;

/** Width and height (km) of a south, west, north, east box. */
export function boxKm([s, w, n, e]: [number, number, number, number]) {
  return { width: (e - w) * KM_PER_DEG * Math.cos((((n + s) / 2) * Math.PI) / 180), height: (n - s) * KM_PER_DEG };
}

/** The box cut into tiles of at most `km` (MAX_BOX_KM) a side, to load a larger area box by box; [] above `maxTiles`. */
export function tiles(box: [number, number, number, number], km = MAX_BOX_KM, maxTiles = 16): [number, number, number, number][] {
  const [s, w, n, e] = box;
  const { width, height } = boxKm(box);
  const nx = Math.max(1, Math.ceil(width / (km * 0.999)));
  const ny = Math.max(1, Math.ceil(height / (km * 0.999)));
  if (nx * ny > maxTiles) return [];
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < ny; i++)
    for (let j = 0; j < nx; j++) out.push([s + ((n - s) * i) / ny, w + ((e - w) * j) / nx, s + ((n - s) * (i + 1)) / ny, w + ((e - w) * (j + 1)) / nx]);
  return out;
}

export const LINES_ATTRIBUTION = "Wärmeliniendichte © LEA Hessen (Wärmeatlas Hessen), modelled useful heat 2020";
/** Heat line density classes (MWh per m of street and year, upper bounds) and colours, light to dark: under 1.5 a
 * network rarely pays (the rule of thumb), above 4 it is dense. */
export const LINE_CLASSES: { upTo: number; color: string }[] = [
  { upTo: 0.75, color: "#c6dbef" },
  { upTo: 1.5, color: "#6baed6" },
  { upTo: 2.5, color: "#fd8d3c" },
  { upTo: 4, color: "#e6550d" },
  { upTo: Infinity, color: "#a63603" },
];
export const lineColor = (mwhPerM: number) => LINE_CLASSES.find((c) => mwhPerM <= c.upTo)!.color;

/** GEMOD's residential types (single-family, terraced, multi-family, large multi-family); the rest is non-residential. */
export const isResidential = (b: WaermeatlasBuilding) => ["EFH", "RH", "MFH", "GMH"].includes(b.type ?? "");

/**
 * What a building is used for, in a colour each (for the heat sinks' bubbles: the buildings keep their heat demand's): homes blue, offices and administration light blue, shops and transport
 * magenta (the Wärmeatlas has no industry type: its heat demand is buildings', not processes'; one that comes with a
 * later import goes there too), everything else (schools, health, hotels, culture, sport, research) grey.
 */
export const USE_CLASSES = [
  { id: "home", label: "Homes", color: "#2f6fdb" },
  { id: "office", label: "Offices", color: "#7cc4f5" },
  { id: "trade", label: "Commerce and industry", color: "#d63bb8" },
  { id: "other", label: "Public and other", color: "#b4b4bc" },
] as const;
export type UseClass = (typeof USE_CLASSES)[number]["id"];

export function classOfUse(b: Pick<WaermeatlasBuilding, "type" | "use">): UseClass {
  const t = b.type ?? "";
  if (isResidential({ type: t } as WaermeatlasBuilding)) return "home";
  if (t.startsWith("Büro")) return "office";
  if (/Handel|Verkehr|Gewerbe|Industrie|Produktion|Werkstatt|Lager/.test(t)) return "trade";
  return "other";
}
export const colorOfUse = (b: Pick<WaermeatlasBuilding, "type" | "use">) => USE_CLASSES.find((c) => c.id === classOfUse(b))!.color;

const dist2 = (b: { lat: number; lon: number }, lat: number, lon: number) => (b.lat - lat) ** 2 + (b.lon - lon) ** 2;

/** Whether the point lies inside the ring (ray casting; lat/lon as plane coordinates is fine for one building). */
export function contains(ring: [number, number][], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i];
    const [aj, oj] = ring[j];
    if (oi > lon !== oj > lon && lat < ((aj - ai) * (lon - oi)) / (oj - oi) + ai) inside = !inside;
  }
  return inside;
}

/** The building at a point: inside its outline, else the nearest within ~30 m; none: null. */
export function atlasBuildingAt(buildings: WaermeatlasBuilding[], lat: number, lon: number): WaermeatlasBuilding | null {
  const inside = buildings.find((b) => b.outline && contains(b.outline, lat, lon));
  return inside ?? buildings.reduce<WaermeatlasBuilding | null>((best, b) => (dist2(b, lat, lon) < (best ? dist2(best, lat, lon) : 1e-7) ? b : best), null);
}

/** Each sink's use colour, from the loaded Wärmeatlas building it was taken from or stands on (by OpenStreetMap); sinks on none are left out. */
export function sinkUseColors(buildings: WaermeatlasBuilding[], sinks: HeatPoint[]): Map<string, string> {
  const byId = new Map(buildings.map((b) => [sinkId(b), b]));
  const out = new Map<string, string>();
  for (const s of sinks) {
    if (s.area) continue; // a drawn district: many buildings
    const b = byId.get(s.id) ?? atlasBuildingAt(buildings, s.lat, s.lon);
    if (b) out.set(s.id, colorOfUse(b));
  }
  return out;
}

/** Sequential classes (MWh/a, upper bounds) and colours, light to dark: buildings span 1 MWh to several GWh. */
export const HEAT_CLASSES: { upTo: number; color: string }[] = [
  { upTo: 20, color: "#ffffb2" },
  { upTo: 50, color: "#fed976" },
  { upTo: 100, color: "#feb24c" },
  { upTo: 250, color: "#fd8d3c" },
  { upTo: 500, color: "#fc4e2a" },
  { upTo: 1000, color: "#e31a1c" },
  { upTo: Infinity, color: "#b10026" },
];

/** Fill colour of a building with this annual demand (kWh/a). */
export const heatColor = (kwh: number) => HEAT_CLASSES.find((c) => kwh / 1000 <= c.upTo)!.color;

/** Annual demand of a building as a heat sink: heating + hot water, non-residential times the correction factor. */
export const annualKwh = (b: WaermeatlasBuilding, nonResidentialFactor: number) =>
  ((b.heating_kwh ?? 0) + (b.hot_water_kwh ?? 0)) * (isResidential(b) ? 1 : nonResidentialFactor);

/** Tooltip HTML (Leaflet sets it as innerHTML: every text from the data is escaped). */
export function tooltipHtml(b: WaermeatlasBuilding): string {
  const kind = escapeHtml([b.use, b.type && b.type !== b.use ? b.type : null].filter(Boolean).join(" · ") || "Building");
  const age = b.age ? `built ${escapeHtml(b.age)}${b.age_share != null ? ` (p = ${fmt(b.age_share, 2)})` : ""}` : "age unknown";
  return [
    `<b>${kind}</b>`,
    `${age} · ${b.area_m2 != null ? fmt(b.area_m2) : "–"} m² heated`,
    `Heating ${fmt((b.heating_kwh ?? NaN) / 1000, 1)} MWh/a · hot water ${fmt((b.hot_water_kwh ?? NaN) / 1000, 1)} MWh/a`,
  ].join("<br>");
}

/** The sink id of a Wärmeatlas building: stable, so the same building is never added twice. */
export const sinkId = (b: WaermeatlasBuilding) => `wah-${b.id}`;

/** A building as a heat sink: one "house" with the building's annual demand and its hot-water share. */
export function toSink(b: WaermeatlasBuilding, nonResidentialFactor: number): HeatPoint {
  const kwh = annualKwh(b, nonResidentialFactor);
  const total = (b.heating_kwh ?? 0) + (b.hot_water_kwh ?? 0);
  return {
    id: sinkId(b),
    name: `${b.use ?? "Building"} ${b.id}`,
    lat: b.lat,
    lon: b.lon,
    temp_c: 60,
    power_kw: Math.round(kwh / FULL_LOAD_HOURS),
    outline: b.outline,
    demand: {
      houses: 1,
      kwhPerHouse: Math.round(kwh),
      dhwShare: total ? Math.round(((b.hot_water_kwh ?? 0) / total) * 1000) / 1000 : 0,
      profile: profileFor(b.type, b.use),
    },
  };
}

/** The site with these buildings added as heat sinks (those already a sink are skipped). */
export function withBuildings(s: Site, buildings: WaermeatlasBuilding[], nonResidentialFactor: number): Site {
  const have = new Set(s.sinks.map((x) => x.id));
  const added = buildings.filter((b) => !have.has(sinkId(b))).map((b) => toSink(b, nonResidentialFactor));
  return added.length ? { ...s, sinks: [...s.sinks, ...added] } : s;
}

/**
 * The site with each drawn district (an area sink) as its Wärmeatlas buildings inside it, `byArea` (area id → the
 * buildings of its box): each a heat sink with the area's settings and its share of the area's demand by its
 * Wärmeatlas demand, so the heat network plans a pipe to each and shows each one's heat. An area without a building
 * inside (or not loaded) stays one sink. `areaKwh`: the area's demand a year (its settings', demandEntries).
 */
export function areasAsBuildings(s: Site, byArea: ReadonlyMap<string, WaermeatlasBuilding[]>, areaKwh: (id: string) => number | null): Site {
  let split = false;
  const sinks = s.sinks.flatMap((a): HeatPoint[] => {
    const kwh = a.area && a.outline ? areaKwh(a.id) : null;
    const inside = kwh != null && a.outline ? (byArea.get(a.id) ?? []).filter((b) => insideRing(a.outline!, b.lat, b.lon)) : [];
    const weight = inside.map((b) => annualKwh(b, 1));
    const sum = weight.reduce((x, y) => x + y, 0);
    if (!inside.length || !(sum > 0) || kwh == null) return [a];
    split = true;
    return inside.map((b, i) => ({
      ...a,
      id: `${a.id}~${b.id}`,
      name: `${a.name} · ${i + 1}`,
      lat: b.lat,
      lon: b.lon,
      outline: b.outline,
      area: false,
      power_kw: (a.power_kw * weight[i]) / sum,
      demand: { ...a.demand, houses: 1, kwhPerHouse: (kwh * weight[i]) / sum },
    }));
  });
  return split ? { ...s, sinks } : s;
}

/** Whether the point lies inside the ring (ray casting; lat/lon as plane coordinates is fine at a district's scale). */
export function insideRing(ring: [number, number][], lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, oi] = ring[i];
    const [aj, oj] = ring[j];
    if (oi > lon !== oj > lon && lat < ((aj - ai) * (lon - oi)) / (oj - oi) + ai) inside = !inside;
  }
  return inside;
}

/** The south, west, north, east box around a ring. */
export const ringBox = (ring: [number, number][]): [number, number, number, number] => [
  Math.min(...ring.map((p) => p[0])),
  Math.min(...ring.map((p) => p[1])),
  Math.max(...ring.map((p) => p[0])),
  Math.max(...ring.map((p) => p[1])),
];

/**
 * A drawn district's heat demand from the Wärmeatlas buildings whose centre lies inside it: the buildings, their annual
 * MWh, and the area sink's demand settings (one "house" per building at their mean demand, their hot-water share, the
 * profile of the buildings with the most demand) and bubble power; null without a building inside.
 */
export function areaDemand(ring: [number, number][], buildings: WaermeatlasBuilding[], nonResidentialFactor = 1) {
  const inside = buildings.filter((b) => insideRing(ring, b.lat, b.lon));
  if (!inside.length) return null;
  const kwh = inside.reduce((a, b) => a + annualKwh(b, nonResidentialFactor), 0);
  const total = inside.reduce((a, b) => a + (b.heating_kwh ?? 0) + (b.hot_water_kwh ?? 0), 0);
  const dhw = inside.reduce((a, b) => a + (b.hot_water_kwh ?? 0), 0);
  const byProfile = new Map<string, number>();
  for (const b of inside) {
    const p = profileFor(b.type, b.use);
    byProfile.set(p, (byProfile.get(p) ?? 0) + annualKwh(b, nonResidentialFactor));
  }
  const profile = [...byProfile].sort((a, b) => b[1] - a[1])[0][0];
  return {
    buildings: inside,
    mwh: kwh / 1000,
    power_kw: Math.round(kwh / FULL_LOAD_HOURS),
    demand: {
      houses: inside.length,
      kwhPerHouse: Math.round(kwh / inside.length),
      dhwShare: total ? Math.round((dhw / total) * 1000) / 1000 : 0,
      profile,
    },
  };
}
