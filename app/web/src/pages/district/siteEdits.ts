/** Pure edits of a Site from map clicks: choose the data center's building, add a heat sink, add a drawn district area. */
import type { HeatPoint, Site } from "../../api";
import { AALBORG_RESIDENTIAL, HELSINKI_PUBLIC } from "../../lib/profilePresets";
import { centroid, type Building, type Ring } from "./osm";

const DEFAULT_SOURCE = { id: "dc", name: "Data center", temp_c: 35, power_kw: 40, utilization: 0.3 }; // a new data center: its IT ~30 % busy on average

export { IDLE_SHARE, powerShare, wasteKw } from "../../lib/wasteHeat"; // pure, in lib/; kept here for its callers

/** The data center is this building; its heat-source bubble moves to the building's centre. */
export function withBuilding(s: Site, b: Building): Site {
  const [lat, lon] = centroid(b.ring);
  return { ...s, building: { name: b.name, osm_id: b.id, outline: b.ring }, source: { ...(s.source ?? DEFAULT_SOURCE), lat, lon } };
}

/** OSM's building types (building=*) and the Wärmeatlas' (EFH, RH, MFH, GMH) by the standard profile they get. */
const SINGLE = ["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "cabin", "EFH", "RH"];
const MULTI = ["apartments", "residential", "dormitory", "MFH", "GMH"];
const OFFICE = ["office", "commercial", "government", "public", "civic", "bank", "school", "kindergarten", "college", "university", "hospital", "townhall"];
const SHOP = ["retail", "supermarket", "kiosk", "shop"];
const INDUSTRY = ["industrial", "manufacture", "factory"];

/** The heat profile a building of this type gets as it becomes a heat sink (lib/profilePresets.ts), each checked on
 * measured buildings: homes (single- and
 * multi-family, and an unknown type) the Aalborg model, learned from measured homes; offices, public bodies, schools and
 * any other named non-residential use the Helsinki model, learned from measured offices, schools and day care (both beat
 * BDEW's profiles); trade BDEW's gas standard profile (too few measured shops to learn from); industry a flat profile:
 * its heat follows its shifts and processes, not the weather (ask for its metered load). */
export function profileFor(type?: string | null, use?: string | null): string {
  const t = type ?? "";
  if (SINGLE.includes(t) || MULTI.includes(t)) return AALBORG_RESIDENTIAL;
  if (SHOP.includes(t) || /handel|laden|verkauf|kauf/i.test(use ?? "")) return "bdew-gha03";
  if (INDUSTRY.includes(t) || /industrie|produktion|fabrik|werkstatt/i.test(use ?? "")) return "constant";
  if (OFFICE.includes(t) || /büro|verwaltung|schule|bank|öffentlich/i.test(use ?? "")) return HELSINKI_PUBLIC;
  return use && !/wohn/i.test(use) ? HELSINKI_PUBLIC : AALBORG_RESIDENTIAL;
}

/** A new heat sink: the clicked building (outline + bubble at its centre, its type's profile), or a plain bubble where there is none. */
export function withSink(s: Site, lat: number, lon: number, b: Building | null): Site {
  const [clat, clon] = b ? centroid(b.ring) : [lat, lon];
  const sink: HeatPoint = {
    id: crypto.randomUUID(),
    name: b?.name ?? `Heat sink ${s.sinks.length + 1}`,
    lat: clat,
    lon: clon,
    temp_c: 60,
    power_kw: 100,
    outline: b?.ring ?? null,
    ...(b ? { demand: { profile: profileFor(b.type) } } : {}),
  };
  return { ...s, sinks: [...s.sinks, sink] };
}

/** A drawn area (open ring of >= 3 corners) as one heat sink standing for a whole district, bubble at its centre, with
 * the homes' profile (the Aalborg model). */
export function withArea(s: Site, corners: Ring): Site {
  const [lat, lon] = centroid([...corners, corners[0]]); // centroid takes a closed ring
  const n = s.sinks.filter((x) => x.area).length + 1;
  const sink: HeatPoint = {
    id: crypto.randomUUID(),
    name: `District ${n}`,
    lat,
    lon,
    temp_c: 70,
    power_kw: 500,
    outline: corners,
    area: true,
    demand: { profile: AALBORG_RESIDENTIAL },
  };
  return { ...s, sinks: [...s.sinks, sink] };
}

/** Distance in metres between two points (haversine on a sphere of the Earth's mean radius). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
