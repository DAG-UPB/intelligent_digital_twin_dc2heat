/**
 * OpenStreetMap lookups for the Site map: address search (Nominatim) and "which building is under this
 * click" (Nominatim reverse, then Nominatim street search, then Overpass), the streets of a box for the heat network
 * (Overpass), plus the small polygon helpers
 * they need. Talks to the public OSM servers directly (not our backend); the geometry helpers are pure.
 */
import type { StreetWay } from "../../api";

/** A polygon ring as [lat, lon] points (Leaflet's order; GeoJSON is [lon, lat]). */
export type Ring = [number, number][];
/** A street or pipe as a line of [lat, lon] points. */
export type Line = [number, number][];

/** A building found on OSM: its display name, OSM id and outline. */
export interface Building {
  name: string;
  id: number;
  ring: Ring;
  type?: string; // OSM's building=* (apartments, house, office, …): the profile it gets as a heat sink
}

const NOMINATIM = "https://nominatim.openstreetmap.org";
// A slow public server (~30 s a query): overpass-api.de, then its two servers directly (the same operator, FOSSGIS), as
// the one asked is often busy (429, 502, 504) while another answers; all three busy at once: once more after a pause.
const OVERPASS = ["overpass-api.de", "lz4.overpass-api.de", "z.overpass-api.de"].map((host) => `https://${host}/api/interpreter`);
const OVERPASS_TIMEOUT_MS = 75000;
const OVERPASS_PAUSE_MS = 10000;
const busy = (status: number) => status === 429 || status >= 500;

/** POST an Overpass query: the next server when one is busy or cannot be reached, each twice; a timeout ends it (a slow
 * answer, not a refusal: asking again would only wait longer). The last answer, ok or not; throws the last error when
 * none answered. */
async function overpass(query: string): Promise<Response> {
  let last: Response | undefined;
  let error: unknown;
  for (const [i, url] of [...OVERPASS, ...OVERPASS].entries()) {
    if (i === OVERPASS.length) await new Promise((done) => setTimeout(done, OVERPASS_PAUSE_MS));
    try {
      last = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS) });
      if (!busy(last.status)) return last;
    } catch (err) {
      if ((err as Error).name === "TimeoutError") throw err;
      error = err; // a busy server's error page often lacks CORS headers: the browser reports a network error
    }
  }
  if (last) return last;
  throw error;
}
/**
 * The OSM highways a heating pipe can run under or along: roads of every rank but motorways (fenced, never dug up for
 * a house), service roads and squares (into courtyards and campuses), foot and cycle paths, tracks. Not steps, indoor
 * corridors or platforms. Road tunnels are left out (the pipe runs in the street above); bridges stay (pipes hang on them).
 */
const ROADS = "trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service";
const PIPE_HIGHWAYS = `${ROADS}|pedestrian|footway|path|cycleway|track`;
const MAX_STREETS_KM = 3; // a district's box; a larger one is a heavy query for a public server

/** Ray casting: is (lat, lon) inside the ring? */
export function contains(ring: Ring, lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Mean of the corners of a closed ring (the last point repeats the first and is left out). */
export function centroid(ring: Ring): [number, number] {
  const pts = ring.slice(0, -1);
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

interface GeoJson {
  type?: string;
  coordinates?: unknown;
}

/** The outer ring of a GeoJSON Polygon or (first) MultiPolygon as [lat, lon]; null for anything else. */
export function outerRing(g: GeoJson | null | undefined): Ring | null {
  const c = g?.coordinates as number[][][] & number[][][][];
  const outer: number[][] | undefined = g?.type === "Polygon" ? c[0] : g?.type === "MultiPolygon" ? c[0][0] : undefined;
  return outer ? outer.map(([lon, lat]) => [lat, lon]) : null;
}

const getJson = (url: string) => fetch(url).then((res) => res.json());

/** Where an address is ([lat, lon]), or null when Nominatim does not know it. Throws when OSM cannot be reached. */
export async function searchAddress(query: string): Promise<[number, number] | null> {
  const hits = await getJson(`${NOMINATIM}/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
  return hits.length ? [Number(hits[0].lat), Number(hits[0].lon)] : null;
}

/**
 * What a way is, from its OSM tags. OSM maps a road's sidewalks and crossings as foot or cycle ways of their own beside
 * and across it (footway, path or cycleway = sidewalk, sidepath, crossing or traffic_island; is_sidepath=yes): the heat
 * network leaves those out, so its pipe runs once, under the road. Other foot and cycle ways and pedestrian areas are
 * paths: they reach courtyards and car-free streets. A road stays a road whatever its cycleway tag (a lane on it).
 */
export function streetKind(tags: Record<string, string | undefined>): StreetWay["kind"] {
  if (ROADS.split("|").includes(tags.highway ?? "")) return "road";
  const sub = [tags.footway, tags.path, tags.cycleway];
  if (tags.is_sidepath === "yes" || sub.some((v) => v === "sidewalk" || v === "sidepath")) return "sidewalk";
  return sub.some((v) => v === "crossing" || v === "traffic_island") ? "crossing" : "path";
}

type OsmWay = { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };

/** Overpass ways (out geom) as street ways: each its kind, its points rounded to 6 decimals (~0.1 m), so ways meet where
 * they share a point; a way of one point is left out. */
export const streetWays = (ways: OsmWay[]): StreetWay[] =>
  ways
    .filter((x) => (x.geometry?.length ?? 0) > 1)
    .map((x) => ({ kind: streetKind(x.tags ?? {}), line: x.geometry!.map((p): [number, number] => [r6(p.lat), r6(p.lon)]) }));
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The streets and paths in a south, west, north, east box, from Overpass (the example's are stored instead): on the
 * user's click only, never on load (a slow public server, ~5-40 s), as streetWays. Throws a readable error for a box
 * over 3 km, a timeout or a refusal.
 */
export async function streetsIn([s, w, n, e]: [number, number, number, number]): Promise<StreetWay[]> {
  const km = Math.max(n - s, (e - w) * Math.cos((((n + s) / 2) * Math.PI) / 180)) * 111.32;
  if (km > MAX_STREETS_KM) throw new Error(`The heat sinks spread over ${Math.round(km)} km: streets are loaded for at most ${MAX_STREETS_KM} km`);
  const q = `[out:json][timeout:60];way["highway"~"^(${PIPE_HIGHWAYS})$"]["tunnel"!="yes"](${s},${w},${n},${e});out geom;`;
  const res = await overpass(q).catch((err: Error) => {
    throw new Error(
      err.name === "TimeoutError"
        ? "OpenStreetMap (Overpass) did not send the streets within 75 s: try again later"
        : `OpenStreetMap could not be reached: ${err.message}`,
    );
  });
  if (!res.ok) throw new Error(`OpenStreetMap (Overpass) refused the streets (${res.status}): try again in a minute`);
  return streetWays((await res.json()).elements ?? []);
}

/** The one building under a clicked point, or null (street, open ground). Throws when OSM does not answer. */
export async function buildingAt(lat: number, lon: number): Promise<Building | null> {
  // 1. Nominatim reverse, address layer: fast (< 1 s), returns the building polygon when you click on one.
  const r = await getJson(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&layer=address&polygon_geojson=1`);
  const a = r?.address ?? {};
  const ring = outerRing(r?.geojson);
  if (r?.category === "building" && ring) {
    const name = r.name || [a.road, a.house_number].filter(Boolean).join(" ") || `Building ${r.osm_id}`;
    return { name, id: r.osm_id, ring, type: r.type };
  }
  // Streets and open areas: answer "no building" right away.
  if (r?.geojson?.type !== "Point") return null;

  // 2. Clicked a shop, office or house number inside a building (a point): search its street address,
  //    which is usually the building's address too. Fast.
  if (a.road && a.house_number) {
    const params = new URLSearchParams({
      street: `${a.house_number} ${a.road}`,
      postalcode: a.postcode ?? "",
      city: a.city ?? a.town ?? a.village ?? "",
      format: "jsonv2",
      polygon_geojson: "1",
      limit: "5",
    });
    const hits = await getJson(`${NOMINATIM}/search?${params}`);
    for (const h of hits) {
      const ring = outerRing(h.geojson);
      if (h.category === "building" && ring && contains(ring, lat, lon)) return { name: h.name || `${a.road} ${a.house_number}`, id: h.osm_id, ring, type: h.type };
    }
  }

  // 3. Last resort: ask Overpass which building contains the point. Slow (~30 s).
  const q = `[out:json][timeout:25];is_in(${lat},${lon})->.a;way(pivot.a)["building"];out geom tags;`;
  const res = await overpass(q);
  const w = res.ok ? (await res.json()).elements?.[0] : undefined;
  if (!w) return null;
  const t = w.tags ?? {};
  return {
    name: t.name || [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || `Building ${w.id}`,
    id: w.id,
    ring: w.geometry.map((p: { lat: number; lon: number }) => [p.lat, p.lon]),
    type: t.building,
  };
}

/** An OSM element with its bounding box (Overpass `out bb`). */
type Bounded = { tags?: Record<string, string>; bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number } };

/** Of the forests and woods around (lat, lon), the nearest of at least `minHa` (its box's area), else the biggest: its
 * centre and name; null when there is none. Pure. */
export function pickForest(found: Bounded[], lat: number, lon: number, minHa = 30): { lat: number; lon: number; name: string | null } | null {
  const all = found.flatMap((e) => {
    const b = e.bounds;
    if (!b) return [];
    const [cLat, cLon] = [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2];
    const cos = Math.cos((cLat * Math.PI) / 180);
    const ha = (b.maxlat - b.minlat) * 111.32 * (b.maxlon - b.minlon) * 111.32 * cos * 100;
    const km = Math.hypot(cLat - lat, (cLon - lon) * cos) * 111.32;
    return [{ lat: cLat, lon: cLon, name: e.tags?.name ?? null, ha, km }];
  });
  const big = all.filter((f) => f.ha >= minHa).sort((a, b) => a.km - b.km);
  const f = big[0] ?? all.sort((a, b) => b.ha - a.ha)[0];
  return f ? { lat: f.lat, lon: f.lon, name: f.name } : null;
}

/** The nearest forest around a point, from Overpass (within 20 km): on the user's click only (a public server). */
export async function nearestForest(lat: number, lon: number) {
  const around = `(around:20000,${lat},${lon})`;
  const q = `[out:json][timeout:25];(way["landuse"="forest"]${around};relation["landuse"="forest"]${around};way["natural"="wood"]${around};relation["natural"="wood"]${around};);out bb;`;
  const res = await overpass(q);
  if (!res.ok) throw new Error(`OpenStreetMap (Overpass) refused (${res.status})`);
  return pickForest((await res.json()).elements ?? [], lat, lon);
}
