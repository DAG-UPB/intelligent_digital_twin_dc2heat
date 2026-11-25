/**
 * The Site map's heat network, pure: how the data center's heat reaches the buildings along the streets. The streets
 * (an example's streets.json, or osm.ts streetsIn) become a graph, without the sidewalks and crossings OSM maps beside
 * and across a road: a street's pipe runs once, under the road. The network uses the connected part of that graph most
 * of the demand is near. Every building joins it at the street point under its centre on the street nearest its
 * outline, and a service pipe runs from there straight to the nearest point of the outline (the next street when that
 * line would cross another building). A transmission line runs from the data center to the heat-pump station on the
 * street: straight across the data center's own grounds (at most GROUNDS_M), then along the streets, so a station
 * near the data center gets one straight line and one moved to another street a line that follows the streets; and a
 * distribution tree from the station to the buildings it supplies: a Steiner tree, each building
 * joining the tree by its shortest path to it (Dijkstra), then the shorter of that tree and Mehlhorn's, both cleaned up
 * (the streets' minimum spanning tree between their nodes, the ends that reach no building cut), and no building fed
 * the long way round a loop of streets (at most 1.5 times its shortest way from the station).
 * Which buildings: greedily the one with the most annual demand per metre of pipe it adds, while the data center's
 * heat, through the largest heat pump it allows, still covers a share of the network's yearly heat (BEW's 75 %; the
 * hourly typical year, quickAnalysis.ts sinkKw); branches below a minimum linear heat density are cut and the rest grows
 * again. The heat pump is sized to a share of the network's peak hour (a peak boiler covers the coldest hours), larger
 * if that share of the year needs it, at most what the data center's heat allows; or, as an option, for the whole
 * design peak (their peaks × simultaneity), and then only the buildings it covers at that peak. The station is where
 * the caller puts it, or the one of a few places on the way from the data center to the load whose network needs the
 * least pipe per MWh. With `useAll` the plan uses the data center's heat in full: the heat pump as large as it allows,
 * no reach, and buildings join while each still takes some of its heat (USE_ALL_MARGIN) from the data center.
 */
import type { Site, StreetWay } from "../../api";
import { annualMwh, demandEntries, isIncluded, type DistrictSettings } from "../../lib/demand";
import { fmt } from "../../lib/format";
import { contains, type Line, type Ring } from "./osm";
import { DC_SHARE, heatPumpKw, HP_SHARE } from "./hpSizing";
import { designKw, HOURS, sinkKw } from "./quickAnalysis";
import { distanceM } from "./siteEdits";

/** A building the network can supply. */
export interface NetworkBuilding {
  id: string;
  lat: number;
  lon: number;
  outline?: Ring | null; // its service pipe ends on it (without one: at lat, lon)
  peakKw: number; // its own design peak: on a design day at −12 °C (buildingsOf: quickAnalysis.ts designKw)
  annualMwh: number;
  kw?: ArrayLike<number>; // its demand over the typical year, hourly (buildingsOf; without: flat, annualMwh spread evenly)
}

export interface NetworkInput {
  streets: StreetWay[]; // sidewalks and crossings are left out
  source: { lat: number; lon: number; outline?: Ring | null }; // the data center (its building's outline)
  buildings: NetworkBuilding[];
  capacityKw: number; // the heat pump's heat the data center's heat allows (× COP/(COP−1))
  station?: { lat: number; lon: number } | null; // the heat-pump station where the caller puts it (moved onto the nearest street)
  minDensity?: number; // MWh a year per m of pipe a branch must carry, else it is cut (default 0: none)
  hpShare?: number; // the heat pump's size as a share of the network's peak hour (larger if minDcShare needs it), at most capacityKw (default HP_SHARE)
  minDcShare?: number; // buildings join while the heat pump the data center allows gives this share of the year's heat (default DC_SHARE)
  fullPeak?: boolean; // instead: the heat pump for the whole design peak, and only the buildings whose design peak fits in capacityKw
  maxBuildings?: number; // supply at most this many (default: as many as the rules take)
  maxServiceM?: number; // a building further from every street is not reached (default 150)
  reachM?: number; // only buildings at most this far from the station along the streets join (default: no limit)
  useAll?: boolean; // the data center's heat in full instead: the heat pump as large as it allows, no reach, buildings join while each still takes some of its heat from the data center
  heatLines?: HeatLineIn[]; // the streets' heat line density (Wärmeatlas): the pipes prefer the dense streets
  densityPull?: number; // how strongly, 0 (only the shortest way) .. 1 (default DENSITY_PULL; nothing without heatLines)
}

/** A street segment with its heat line density: the useful heat of the buildings along it per m, MWh/(m·a). */
export interface HeatLineIn {
  line: [number, number][][]; // its parts, [lat, lon]
  mwhPerM: number;
}

export type PipeKind = "transmission" | "distribution" | "service";

/** One run of pipe between two branchings, and what it carries (to size it). */
export interface Pipe {
  kind: PipeKind;
  line: Line; // [lat, lon], downstream last (transmission: data center → station; service: street → building)
  m: number;
  peakKw: number; // design peak of the buildings it serves: their design peaks (on a day at −12 °C) × simultaneity(n)
  annualMwh: number;
  buildings: number;
  served: number[]; // the buildings downstream, as indices into HeatNetwork.chosen (the transmission line: all)
  id?: string; // service: the building's
}

export interface HeatNetwork {
  station: { lat: number; lon: number } | null;
  chosen: string[]; // the buildings supplied, in the order chosen
  pipes: Pipe[];
  m: Record<PipeKind, number>; // pipe (trench) length by kind
  totalM: number;
  annualMwh: number; // the chosen buildings' demand
  peakKw: number; // their design peak (simultaneity): the pipes' and the network pumps' size
  yearPeakKw: number; // their peak hour on the typical year (the hourly profiles summed, no simultaneity)
  hpKw: number; // the station's heat pump
  dcShare: number; // the share of the year's heat (with the pipes' losses estimated) that heat pump gives, 0..1
  density: number; // linear heat density, MWh per m and year: annual demand ÷ m of distribution and service pipe
  streetDensity: number | null; // the heat line density of the streets the distribution pipe runs under, length-weighted, MWh/(m·a) (null: no heatLines)
  unreached: { id: string; reason: string }[];
  problem: string | null; // why there is no network at all
  warning: string | null; // a plan to read with care: the transmission line straight across more than the grounds (no street near the data center)
}

// Simultaneity of n buildings' peaks: Winter, Haslauer & Obernberger (2001), "Untersuchungen der Gleichzeitigkeit in
// kleinen und mittleren Nahwärmenetzen", Euroheat & Power 30 (9, 10); 1 for one building, ~0.53 for 150, → 0.45
const GLF_A = 0.449677646;
const GLF_B = 53.84466557;
const GLF_C = 1.7621969;
export const simultaneity = (n: number) => GLF_A + (1 - GLF_A) / (1 + (n / GLF_B) ** GLF_C);

export { DC_SHARE, HP_SHARE };
/** The hot pipes' heat loss per trench metre while choosing, a little above what networkCost's DN table gives a plan
 * at 70/40 °C (18 W/m at DN50, 23 at DN100; the example's ~22): the economics, with each pipe's own, then find at least
 * the share the plan was chosen for. */
const LOSS_W_PER_M = 25;

const M_PER_DEG = 111_320;
const YEAR_H = HOURS; // a local copy for the hourly loops (vitest's imports are getters, read 8,760 times per loop)
const SNAP_M = 0.05; // a point this close to a street's corner (or another joined point) joins there
const PATH_COST = 1.3; // a footpath's metre costs this much more than a road's in the routing: the main runs under the road
const ROAD_PREFER_M = 25; // a building joins a road this much further off rather than a footpath beside it
const GROUNDS_M = 150; // the data center's own grounds: its line crosses them straight, at most this far, then follows the streets
const USE_ALL_MARGIN = 0.1; // with useAll a building joins while at least this share of its own heat still comes from the data center
const STATION_TRIES = 8; // places tried for the station between the data center and the load
const ROUNDS = 3; // grow, cut the thin branches, grow again without them: at most this often
// A building's way along the network at most this many times its shortest way along the streets from the station (plus
// DETOUR_M): the shortest trench alone cuts a loop of streets where that saves most, and the buildings beyond the cut
// are fed the long way round (on the example the farthest 1.65 km instead of 0.7): the longest way sets the pumps' head
const DETOUR = 1.5;
const DETOUR_M = 50;
const REUSE = 0.2; // the way that replaces a long one keeps to the tree's streets where they are at most 20 % longer
// The pipes prefer dense streets: in the choice of the way (not in the metres, the reach or the detours) a street's
// metre counts 1 / (1 + pull · min(d, DENSITY_CAP) / DENSITY_REF), d its heat line density: at pull 1 a street of
// 1.5 MWh/(m·a) (the rule of thumb for a network) half, one of 6 or more a fifth
export const DENSITY_PULL = 0.5;
const DENSITY_REF = 1.5;
const DENSITY_CAP = 6;
const MATCH_M = 20; // a street segment takes the density of the Wärmeatlas segment within this distance of its middle
const MATCH_COS = 0.8; // and about parallel to it (|cos| of the angle between them): not a cross street at a corner

/** Each street segment's heat line density (0 where none matches): the Wärmeatlas segment nearest its middle within
 * MATCH_M and about parallel. The segments in metres east and north [x1, y1, x2, y2], the lines' points [lat, lon]
 * through `toXy`. A grid of MATCH_M cells keeps the search to the lines nearby. */
export function streetDensities(
  segs: [number, number, number, number][],
  lines: HeatLineIn[],
  toXy: (la: number, lo: number) => [number, number],
): Float64Array {
  const out = new Float64Array(segs.length);
  const grid = new Map<string, number[]>(); // a cell's pieces, as indices into `pieces` (x1, y1, x2, y2, d each)
  const pieces: number[] = [];
  for (const h of lines) {
    if (!(h.mwhPerM > 0)) continue;
    for (const part of h.line)
      for (let i = 1; i < part.length; i++) {
        const [ax, ay] = toXy(part[i - 1][0], part[i - 1][1]);
        const [bx, by] = toXy(part[i][0], part[i][1]);
        const k = pieces.length / 5;
        pieces.push(ax, ay, bx, by, h.mwhPerM);
        // every cell the piece's box touches, widened by one: a middle within MATCH_M finds it in its own cell
        for (let gx = Math.floor(Math.min(ax, bx) / MATCH_M) - 1; gx <= Math.floor(Math.max(ax, bx) / MATCH_M) + 1; gx++)
          for (let gy = Math.floor(Math.min(ay, by) / MATCH_M) - 1; gy <= Math.floor(Math.max(ay, by) / MATCH_M) + 1; gy++) {
            const key = gx + "," + gy;
            const c = grid.get(key);
            if (c) c.push(k);
            else grid.set(key, [k]);
          }
      }
  }
  segs.forEach(([ax, ay, bx, by], s) => {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const dl = hyp(dx, dy);
    let best = MATCH_M;
    for (const k of grid.get(Math.floor(mx / MATCH_M) + "," + Math.floor(my / MATCH_M)) ?? []) {
      const [px, py, qx, qy, d] = [pieces[5 * k], pieces[5 * k + 1], pieces[5 * k + 2], pieces[5 * k + 3], pieces[5 * k + 4]];
      const ex = qx - px;
      const ey = qy - py;
      const el = hyp(ex, ey);
      if (dl > 0 && el > 0 && Math.abs(dx * ex + dy * ey) / (dl * el) < MATCH_COS) continue;
      const u = el > 0 ? Math.min(1, Math.max(0, ((mx - px) * ex + (my - py) * ey) / (el * el))) : 0;
      const dist = hyp(px + u * ex - mx, py + u * ey - my);
      if (dist <= best) [best, out[s]] = [dist, d];
    }
  });
  return out;
}

/** The south, west, north, east box around these points plus `marginM`: the streets to load for a site (osm.ts streetsIn). */
export function streetBox(points: { lat: number; lon: number }[], marginM = 150): [number, number, number, number] {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const [s, n] = [Math.min(...lats), Math.max(...lats)];
  const dLon = marginM / (M_PER_DEG * Math.cos((((s + n) / 2) * Math.PI) / 180));
  return [s - marginM / M_PER_DEG, Math.min(...lons) - dLon, n + marginM / M_PER_DEG, Math.max(...lons) + dLon];
}

// each sink's typical year by its settings: the plan, the economics and the hour by hour view ask for the same ones
const kwCache = new Map<string, Float64Array>();
/** One sink's demand over the typical year, kW per hour (quickAnalysis.ts sinkKw), cached. Read only. */
export function buildingKw(s: DistrictSettings): Float64Array {
  const key = JSON.stringify(s);
  let kw = kwCache.get(key);
  if (!kw) {
    if (kwCache.size > 2000) kwCache.clear(); // ponytail: a crude bound, as quickAnalysis's shapes; an LRU if it matters
    kw = Float64Array.from(sinkKw(s));
    kwCache.set(key, kw);
  }
  return kw;
}

/** The site's included heat sinks as buildings: their typical year (quickAnalysis.ts sinkKw), their design peak (on a
 * design day at −12 °C, at least the typical year's largest hour: designKw) and their annual demand. */
export function buildingsOf(site: Site): NetworkBuilding[] {
  const entries = new Map(site.sinks.length ? demandEntries(site).map((e) => [e.id, e.settings]) : []);
  return site.sinks.flatMap((s) => {
    const set = entries.get(s.id);
    if (!set || !isIncluded(set)) return [];
    const kw = buildingKw(set);
    return [{ id: s.id, lat: s.lat, lon: s.lon, outline: s.outline, peakKw: designKw(set), annualMwh: annualMwh(set), kw }];
  });
}

/** A binary min-heap of graph nodes by distance: Dijkstra's queue (stale entries are skipped by the caller). */
class Heap {
  private d: number[] = [];
  private n: number[] = [];
  get size() {
    return this.d.length;
  }
  push(dist: number, node: number) {
    let i = this.d.length;
    this.d.push(dist);
    this.n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= dist) break;
      this.d[i] = this.d[p];
      this.n[i] = this.n[p];
      i = p;
    }
    this.d[i] = dist;
    this.n[i] = node;
  }
  pop(): [number, number] {
    const top: [number, number] = [this.d[0], this.n[0]];
    const d = this.d.pop()!;
    const n = this.n.pop()!;
    const len = this.d.length;
    if (len) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && this.d[c + 1] < this.d[c]) c++;
        if (this.d[c] >= d) break;
        this.d[i] = this.d[c];
        this.n[i] = this.n[c];
        i = c;
      }
      this.d[i] = d;
      this.n[i] = n;
    }
    return top;
  }
}

/** Dijkstra from the nodes `from` (their `dist` set): lowers `dist` and `via` (the next node towards the nearest of
 * them) and, given, `base` (which of them that is). */
function spread(adj: number[][], dist: Float64Array, via: Int32Array, from: number[], base?: Int32Array) {
  const heap = new Heap();
  for (const s of from) heap.push(dist[s], s);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    const nb = adj[u];
    for (let i = 0; i < nb.length; i += 2) {
      const v = nb[i];
      const nd = d + nb[i + 1];
      if (nd < dist[v]) {
        dist[v] = nd;
        via[v] = u;
        if (base) base[v] = base[u];
        heap.push(nd, v);
      }
    }
  }
}

/** √(a² + b²): Math.hypot is several times slower, and the joins call it a million times. */
const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);

/** A union-find over 0..n−1: `join` says whether a and b were apart. */
function unionFind(n: number) {
  const root = Int32Array.from({ length: n }, (_, i) => i);
  const find = (u: number) => {
    while (root[u] !== u) u = root[u] = root[root[u]];
    return u;
  };
  return { find, join: (a: number, b: number) => (find(a) === find(b) ? false : ((root[find(a)] = find(b)), true)) };
}

/** Whether the segments pq and ab cross (touching ends do not). */
function crosses(px: number, py: number, qx: number, qy: number, ax: number, ay: number, bx: number, by: number) {
  const side = (ux: number, uy: number, vx: number, vy: number, wx: number, wy: number) => (vx - ux) * (wy - uy) - (vy - uy) * (wx - ux);
  return side(px, py, qx, qy, ax, ay) * side(px, py, qx, qy, bx, by) < 0 && side(ax, ay, bx, by, px, py) * side(ax, ay, bx, by, qx, qy) < 0;
}

const empty = (problem: string, buildings: NetworkBuilding[]): HeatNetwork => ({
  station: null,
  chosen: [],
  pipes: [],
  m: { transmission: 0, distribution: 0, service: 0 },
  totalM: 0,
  annualMwh: 0,
  peakKw: 0,
  yearPeakKw: 0,
  hpKw: 0,
  dcShare: 0,
  density: 0,
  streetDensity: null,
  unreached: buildings.map((b) => ({ id: b.id, reason: problem })),
  problem,
  warning: null,
});

/** A street point a point would join at and its service pipe: segment s at t, the pipe's end q, its length d (m). */
interface Join {
  s: number;
  t: number;
  sx: number;
  sy: number;
  q: [number, number]; // [lat, lon]
  qx: number;
  qy: number;
  d: number;
}

/** The heat network of `input`: the station, the buildings chosen, every pipe and the totals. Deterministic. */
export function planNetwork(input: NetworkInput): HeatNetwork {
  const { source, buildings, capacityKw } = input;
  const minDensity = input.minDensity ?? 0;
  const maxBuildings = input.maxBuildings ?? Infinity;
  const maxServiceM = input.maxServiceM ?? 150;
  const useAll = !!input.useAll && !input.fullPeak;
  const reachM = useAll ? Infinity : (input.reachM ?? Infinity);
  const hpShare = input.hpShare ?? HP_SHARE;
  const minDcShare = input.minDcShare ?? DC_SHARE;
  const fullPeak = !!input.fullPeak;
  const pull = input.heatLines?.length ? Math.max(0, input.densityPull ?? DENSITY_PULL) : 0;

  // metres east and north of the data center, flat at a district's scale: for the nearest points (lengths are distanceM's)
  const kx = M_PER_DEG * Math.cos((source.lat * Math.PI) / 180);
  const lat: number[] = [];
  const lon: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const addNode = (la: number, lo: number) => {
    lat.push(la);
    lon.push(lo);
    x.push((lo - source.lon) * kx);
    y.push((la - source.lat) * M_PER_DEG);
    return lat.length - 1;
  };
  // one node per distinct point (ways meet where they share one), each street segment once; a road's sidewalks and
  // crossings are left out: else a pipe runs along each sidewalk (the buildings on each side join their own) and beside
  // the road's, and the metres double. The service pipes cross the sidewalk instead
  const ids = new Map<string, number>();
  const segs: [number, number][] = [];
  const segPath: boolean[] = []; // a footpath (OSM maps many beside the roads without calling them sidewalks)
  const seen = new Set<string>();
  for (const { line: way, kind } of input.streets.filter((w) => w.kind !== "sidewalk" && w.kind !== "crossing"))
    for (let i = 1; i < way.length; i++) {
      const [a, b] = [way[i - 1], way[i]].map(([la, lo]) => {
        const k = `${la},${lo}`;
        if (!ids.has(k)) ids.set(k, addNode(la, lo));
        return ids.get(k)!;
      });
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a !== b && !seen.has(k)) {
        seen.add(k);
        segs.push([a, b]);
        segPath.push(kind === "path");
      }
    }
  if (!segs.length) return empty("No streets around the site", buildings);

  // which connected part of the streets each segment is on: a path that met the roads only at a sidewalk or a crossing
  // is a part of its own now
  const uf = unionFind(lat.length);
  for (const [a, b] of segs) uf.join(a, b);
  const part = segs.map(([a]) => uf.find(a));

  // the points to join: the data center (0), the buildings (1..B), a placed station (B + 1); their outlines in metres
  const B = buildings.length;
  const points: { lat: number; lon: number; outline?: Ring | null }[] = [source, ...buildings, ...(input.station ? [input.station] : [])];
  const px = points.map((p) => (p.lon - source.lon) * kx);
  const py = points.map((p) => (p.lat - source.lat) * M_PER_DEG);
  const rings = points.map((p) => (p.outline && p.outline.length > 2 ? p.outline : null));
  const ringXy = rings.map((r) => r?.map(([la, lo]) => [(lo - source.lon) * kx, (la - source.lat) * M_PER_DEG]) ?? null);
  const radius = ringXy.map((r, k) => (r ? Math.max(...r.map(([rx, ry]) => hyp(rx - px[k], ry - py[k]))) : 0));
  const box = ringXy.map((r) =>
    r ? [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))] : null,
  );

  /** Where point k joins segment s, and its service pipe: the street point under its centre, the nearest point of its
   * outline to it (the wall facing the street; on the street point when the street runs through the building). */
  const joinAt = (k: number, s: number, limit: number): Join | null => {
    // plain arithmetic, no destructuring: this runs for every point and segment
    const a = segs[s][0];
    const b = segs[s][1];
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, ((px[k] - x[a]) * dx + (py[k] - y[a]) * dy) / len2)) : 0;
    const sx = x[a] + t * dx;
    const sy = y[a] + t * dy;
    const ring = rings[k];
    const rxy = ringXy[k];
    if (!ring || !rxy) {
      const d = hyp(px[k] - sx, py[k] - sy);
      return d > limit ? null : { s, t, sx, sy, q: [points[k].lat, points[k].lon], qx: px[k], qy: py[k], d };
    }
    if (hyp(px[k] - sx, py[k] - sy) - radius[k] > limit) return null; // the outline is no nearer than this
    const sl = lat[a] + t * (lat[b] - lat[a]);
    const so = lon[a] + t * (lon[b] - lon[a]);
    if (contains(ring, sl, so)) return { s, t, sx, sy, q: [sl, so], qx: sx, qy: sy, d: 0 };
    let [bi, bu, bd] = [0, 0, Infinity];
    for (let i = 1; i < rxy.length; i++) {
      const ax = rxy[i - 1][0];
      const ay = rxy[i - 1][1];
      const ex = rxy[i][0] - ax;
      const ey = rxy[i][1] - ay;
      const e2 = ex * ex + ey * ey;
      const u = e2 ? Math.min(1, Math.max(0, ((sx - ax) * ex + (sy - ay) * ey) / e2)) : 0;
      const d = hyp(ax + u * ex - sx, ay + u * ey - sy);
      if (d < bd) {
        bi = i;
        bu = u;
        bd = d;
      }
    }
    if (bd > limit) return null;
    const [pa, pb, qa, qb] = [ring[bi - 1], ring[bi], rxy[bi - 1], rxy[bi]];
    const q: [number, number] = [pa[0] + bu * (pb[0] - pa[0]), pa[1] + bu * (pb[1] - pa[1])];
    return { s, t, sx, sy, q, qx: qa[0] + bu * (qb[0] - qa[0]), qy: qa[1] + bu * (qb[1] - qa[1]), d: bd };
  };
  /** Whether point k's service pipe `j` would cross another building (or the data center's). */
  const blocked = (k: number, j: Join) => {
    const [lx, hx, ly, hy] = [Math.min(j.sx, j.qx), Math.max(j.sx, j.qx), Math.min(j.sy, j.qy), Math.max(j.sy, j.qy)];
    return ringXy.some((r, o) => {
      const bb = box[o];
      if (o === k || !r || !bb || bb[0] > hx || bb[2] < lx || bb[1] > hy || bb[3] < ly) return false;
      for (let i = 1; i < r.length; i++) if (crosses(j.sx, j.sy, j.qx, j.qy, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1])) return true;
      return false;
    });
  };
  // every point's possible joins, nearest first (the data center and a placed station: any distance);
  // ponytail: a scan of every segment per point (~10 ms for 150 points and 3,000 segments), a grid index for whole towns
  const options = points.map((_, k) => {
    const limit = k === 0 || k === B + 1 ? Infinity : maxServiceM;
    const js: Join[] = [];
    for (let s = 0; s < segs.length; s++) {
      const j = joinAt(k, s, limit);
      if (j) js.push(j);
    }
    return js.sort((p, q) => p.d - q.d || p.s - q.s);
  });

  // the network's part of the streets: the one with the most demand near it (a tie: the data center's); the
  // transmission line runs straight, so the data center's own street does not matter
  let main = part[options[0][0].s];
  const weight = new Map<number, number>([[main, 0]]);
  buildings.forEach((b, i) => {
    const near = options[i + 1][0];
    if (near && b.annualMwh > 0) weight.set(part[near.s], (weight.get(part[near.s]) ?? 0) + b.annualMwh);
  });
  for (const [p, w] of weight) if (w > weight.get(main)!) main = p;
  // each point's join on that part: a building's the nearest whose service pipe crosses no other building (else the nearest)
  const picked = options.map((js, k) => {
    const ours = js.filter((j) => part[j.s] === main);
    const near = (k >= 1 && k <= B && ours.find((j) => !blocked(k, j))) || ours[0] || null;
    // a road a little further off rather than a footpath beside it: the house connection crosses to the main under the road
    const road = near && segPath[near.s] ? ours.find((j) => !segPath[j.s] && j.d <= near.d + ROAD_PREFER_M && !(k >= 1 && k <= B && blocked(k, j))) : null;
    return road || near;
  });

  // split the segments there: a new node per joined point (points closer than SNAP_M share one)
  const onSeg = new Map<number, { t: number; k: number }[]>();
  picked.forEach((j, k) => j && onSeg.set(j.s, [...(onSeg.get(j.s) ?? []), { t: j.t, k }]));
  const joinNode = new Array<number>(points.length).fill(-1);
  const edges: [number, number, number][] = []; // each with its segment
  segs.forEach(([a, b], s) => {
    const joins = onSeg.get(s)?.sort((p, q) => p.t - q.t || p.k - q.k);
    if (!joins) return void edges.push([a, b, s]);
    const segM = hyp(x[b] - x[a], y[b] - y[a]);
    let prev = a;
    let prevT = 0;
    for (const { t, k } of joins) {
      const at = t * segM < SNAP_M ? a : (1 - t) * segM < SNAP_M ? b : (t - prevT) * segM < SNAP_M && prev !== a ? prev : -1;
      joinNode[k] = at >= 0 ? at : addNode(lat[a] + t * (lat[b] - lat[a]), lon[a] + t * (lon[b] - lon[a]));
      if (joinNode[k] !== prev && joinNode[k] !== b) {
        edges.push([prev, joinNode[k], s]);
        [prev, prevT] = [joinNode[k], t];
      }
    }
    edges.push([prev, b, s]);
  });
  const V = lat.length;
  const adj: number[][] = Array.from({ length: V }, () => []);
  const len = (u: number, v: number) => distanceM({ lat: lat[u], lon: lon[u] }, { lat: lat[v], lon: lon[v] });
  // ponytail: the routing's metres are the footpaths' weighted ones (the pipes' own metres are measured: len)
  for (const [u, v, s] of edges) {
    const w = len(u, v) * (segPath[s] ? PATH_COST : 1);
    adj[u].push(v, w);
    adj[v].push(u, w);
  }
  // the real metres (no footpath weighting): the reach is measured on it; adj itself when there is no footpath
  let adjM = adj;
  if (edges.some(([, , s]) => segPath[s])) {
    adjM = Array.from({ length: V }, () => []);
    for (const [u, v] of edges) {
      const w = len(u, v);
      adjM[u].push(v, w);
      adjM[v].push(u, w);
    }
  }
  // the streets' heat line density, per edge (by its two nodes), and the way's choice: adj's metres, a dense street's
  // cheaper (adj itself without heat lines or pull: the plan as before)
  const dens = input.heatLines?.length
    ? streetDensities(
        segs.map(([a, b]): [number, number, number, number] => [x[a], y[a], x[b], y[b]]),
        input.heatLines,
        (la, lo) => [(lo - source.lon) * kx, (la - source.lat) * M_PER_DEG],
      )
    : null;
  const edgeDens = new Map<number, number>();
  if (dens) for (const [u, v, s] of edges) edgeDens.set(Math.min(u, v) * V + Math.max(u, v), dens[s]);
  let adjW = adj;
  if (dens && pull > 0) {
    adjW = Array.from({ length: V }, () => []);
    for (const [u, v, s] of edges) {
      const w = (len(u, v) * (segPath[s] ? PATH_COST : 1)) / (1 + (pull * Math.min(dens[s], DENSITY_CAP)) / DENSITY_REF);
      adjW[u].push(v, w);
      adjW[v].push(u, w);
    }
  }
  /** The metres of the edge u–v: its own, not the routing's footpath weight. */
  const edgeM = len;
  const pt = (v: number): [number, number] => [lat[v], lon[v]];
  const serviceM = points.map((_, k) =>
    picked[k] ? distanceM({ lat: lat[joinNode[k]], lon: lon[joinNode[k]] }, { lat: picked[k]!.q[0], lon: picked[k]!.q[1] }) : Infinity,
  );

  // from the data center's street point along the streets: where the station may go
  const dc = joinNode[0];
  const distDc = new Float64Array(V).fill(Infinity);
  const viaDc = new Int32Array(V).fill(-1);
  distDc[dc] = 0;
  spread(adj, distDc, viaDc, [dc]);
  const stationGiven = input.station ? joinNode[B + 1] : -1;

  const join = (b: number) => joinNode[b + 1];
  const service = (b: number) => serviceM[b + 1];
  const unreached: { id: string; reason: string }[] = [];
  const reach: number[] = [];
  buildings.forEach((b, i) => {
    if (picked[i + 1]) {
      if (b.annualMwh > 0) reach.push(i);
    } else if (options[i + 1].length) unreached.push({ id: b.id, reason: "its street is not connected to the network's" });
    else {
      const all = segs.map((_, s) => joinAt(i + 1, s, Infinity)!.d);
      unreached.push({ id: b.id, reason: `${Math.round(Math.min(...all))} m from the nearest street` });
    }
  });

  // each building's typical year (without one: its annual demand spread evenly), its sum and its largest hour
  const profile = buildings.map((b) =>
    b.kw instanceof Float64Array ? b.kw : b.kw ? Float64Array.from(b.kw) : new Float64Array(YEAR_H).fill((b.annualMwh * 1000) / YEAR_H),
  );
  const kwh = new Float64Array(B);
  const top = new Float64Array(B);
  profile.forEach((p, b) => {
    for (let h = 0; h < YEAR_H; h++) {
      kwh[b] += p[h];
      if (p[h] > top[b]) top[b] = p[h];
    }
  });

  /** The buildings chosen from station `st` (greedy by demand per metre added; not those in `out`) and the tree;
   * `extraM`: metres the final tree is longer than the one grown (its losses count too). */
  const grow = (st: number, out: Uint8Array, extraM = 0) => {
    const dist = new Float64Array(V).fill(Infinity);
    const via = new Int32Array(V).fill(-1);
    const parent = new Int32Array(V).fill(-1);
    const inTree = new Uint8Array(V);
    const taken = new Uint8Array(B);
    const chosen: number[] = [];
    dist[st] = 0;
    inTree[st] = 1;
    spread(adjW, dist, via, [st]);
    // along the streets from the station, in real metres: the reach (dist is the way's weighted cost when a footpath
    // or heat lines weigh it)
    let fromSt = Float64Array.from(dist);
    if (adjW !== adjM) {
      fromSt = new Float64Array(V).fill(Infinity);
      fromSt[st] = 0;
      spread(adjM, fromSt, new Int32Array(V).fill(-1), [st]);
    }
    // the chosen buildings' year, hourly, and the pipe they need: the data center's share of it checked as each joins
    const year = new Float64Array(YEAR_H);
    let yearKwh = 0;
    let bound = 0; // their largest hours summed: no hour of the year is above it
    let metres = 0;
    /** Whether the heat pump the data center allows gives at least minDcShare of the year with building b too. */
    const enough = (b: number, m: number) => {
      const loss = (LOSS_W_PER_M * (m + extraM)) / 1000;
      if (bound + top[b] + loss <= capacityKw) return true;
      const kw = profile[b];
      let covered = 0;
      let before = 0;
      for (let h = 0; h < YEAR_H; h++) {
        const v = year[h] + kw[h] + loss;
        covered += v < capacityKw ? v : capacityKw;
        const u = year[h] + loss;
        before += u < capacityKw ? u : capacityKw;
      }
      // all the heat: the data center's heat it takes on top (the hours the heat pump still has room) against its own
      return useAll ? covered - before >= USE_ALL_MARGIN * kwh[b] : covered >= minDcShare * (yearKwh + kwh[b] + loss * YEAR_H);
    };
    /** The heat pump for the whole peak: whether the peak hour with building b (its profile on the others', the same
     * weather) and the pipes' losses still fits the heat pump the data center allows. */
    const fits = (b: number, m: number) => {
      const loss = (LOSS_W_PER_M * (m + extraM)) / 1000;
      if (bound + top[b] + loss <= capacityKw) return true;
      const kw = profile[b];
      for (let h = 0; h < YEAR_H; h++) if (year[h] + kw[h] + loss > capacityKw) return false;
      return true;
    };
    while (chosen.length < maxBuildings) {
      let best = -1;
      let bestRatio = -1;
      for (const b of reach) {
        if (taken[b] || out[b] || fromSt[join(b)] > reachM) continue;
        const added = dist[join(b)] + service(b);
        const ratio = added > 0 ? buildings[b].annualMwh / added : Infinity;
        if (ratio > bestRatio) [best, bestRatio] = [b, ratio];
      }
      if (best < 0) break;
      taken[best] = 1;
      // its metres (its pipe's losses): its way to the tree; a weighted cost (footpaths, heat lines) only picked it
      let added = service(best);
      if (adjW === adjM) added += dist[join(best)];
      else for (let u = join(best); !inTree[u]; u = via[u]) added += edgeM(u, via[u]);
      // too much for the data center's heat (its share of the year, or the whole peak hour): the next
      if (fullPeak ? !fits(best, metres + added) : !enough(best, metres + added)) continue;
      chosen.push(best);
      metres += added;
      const kw = profile[best];
      for (let h = 0; h < YEAR_H; h++) year[h] += kw[h];
      yearKwh += kwh[best];
      bound += top[best];
      // its way to the tree joins it: each node's parent is the next towards the station
      const fresh: number[] = [];
      for (let u = join(best); !inTree[u]; u = via[u]) {
        parent[u] = via[u];
        inTree[u] = 1;
        dist[u] = 0;
        fresh.push(u);
      }
      if (fresh.length) spread(adjW, dist, via, fresh);
    }
    /** Whether the chosen buildings still get minDcShare of their year with the losses of `m` metres of pipe. */
    const holds = (m: number) => {
      const loss = (LOSS_W_PER_M * m) / 1000;
      let covered = 0;
      for (let h = 0; h < YEAR_H; h++) {
        const v = year[h] + loss;
        covered += v < capacityKw ? v : capacityKw;
      }
      return fullPeak || useAll || covered >= minDcShare * (yearKwh + loss * YEAR_H);
    };
    return { chosen, parent, metres, holds };
  };

  /** The tree that joins `chosen` to station `st`: its nodes parents first, each node's children and buildings. */
  const treeOf = (st: number, chosen: number[], parent: Int32Array) => {
    const kids = new Map<number, number[]>();
    const at = new Map<number, number[]>();
    const inTree = new Set([st]);
    for (const b of chosen) {
      at.set(join(b), [...(at.get(join(b)) ?? []), b]);
      for (let u = join(b); !inTree.has(u); u = parent[u]) {
        inTree.add(u);
        kids.set(parent[u], [...(kids.get(parent[u]) ?? []), u]);
      }
    }
    const order = [st];
    for (let i = 0; i < order.length; i++) order.push(...(kids.get(order[i]) ?? []));
    return { order, kids, at };
  };
  const treeM = (st: number, chosen: number[], parent: Int32Array) =>
    treeOf(st, chosen, parent)
      .order.slice(1)
      .reduce((a, v) => a + len(v, parent[v]), 0);

  /** The streets between `nodes` cut down to a tree joining `terms`: their minimum spanning tree (Kruskal), its ends
   * that are no terminal cut again and again; each node's parent towards `st`, and the tree's metres. */
  const spanning = (nodes: number[], terms: Set<number>, st: number) => {
    const local = new Map(nodes.map((v, i) => [v, i]));
    const es: [number, number, number][] = [];
    for (const u of nodes) for (let i = 0; i < adjW[u].length; i += 2) if (u < adjW[u][i] && local.has(adjW[u][i])) es.push([adjW[u][i + 1], u, adjW[u][i]]);
    es.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    const sets = unionFind(nodes.length);
    const nb = new Map<number, Map<number, number>>(nodes.map((v) => [v, new Map()]));
    for (const [w, u, v] of es)
      if (sets.join(local.get(u)!, local.get(v)!)) {
        nb.get(u)!.set(v, w);
        nb.get(v)!.set(u, w);
      }
    const leaves = nodes.filter((v) => nb.get(v)!.size <= 1 && !terms.has(v));
    while (leaves.length) {
      const v = leaves.pop()!;
      for (const u of nb.get(v)!.keys()) {
        nb.get(u)!.delete(v);
        if (nb.get(u)!.size <= 1 && !terms.has(u)) leaves.push(u);
      }
      nb.get(v)!.clear();
    }
    const parent = new Int32Array(V).fill(-1);
    let m = 0;
    const queue = [st];
    const done = new Set([st]);
    for (let i = 0; i < queue.length; i++)
      for (const [v, w] of nb.get(queue[i]) ?? [])
        if (!done.has(v)) {
          done.add(v);
          parent[v] = queue[i];
          m += w;
          queue.push(v);
        }
    return { parent, m };
  };
  /** Mehlhorn's Steiner tree (1988; Kou, Markowsky & Berman's at the cost of one Dijkstra): each street node to its
   * nearest terminal, the shortest bridge between each two terminals' regions, their minimum spanning tree with each
   * bridge laid on its streets, cleaned up. */
  const mehlhorn = (terms: Set<number>, st: number) => {
    const dist = new Float64Array(V).fill(Infinity);
    const via = new Int32Array(V).fill(-1);
    const base = new Int32Array(V).fill(-1);
    for (const t of terms) [dist[t], base[t]] = [0, t];
    spread(adjW, dist, via, [...terms], base);
    const bridge = new Map<number, [number, number, number]>();
    for (let u = 0; u < V; u++)
      for (let i = 0; i < adjW[u].length; i += 2) {
        const v = adjW[u][i];
        if (u > v || base[u] < 0 || base[v] < 0 || base[u] === base[v]) continue;
        const w = dist[u] + adjW[u][i + 1] + dist[v];
        const key = Math.min(base[u], base[v]) * V + Math.max(base[u], base[v]);
        if (!bridge.has(key) || w < bridge.get(key)![0]) bridge.set(key, [w, u, v]);
      }
    const sets = unionFind(V);
    const nodes = new Set(terms);
    for (const [, u, v] of [...bridge.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]))
      if (sets.join(base[u], base[v])) for (const e of [u, v]) for (let w = e; w >= 0 && !nodes.has(w); w = via[w]) nodes.add(w);
    return spanning([...nodes], terms, st);
  };
  /** `tree` without the long ways round: while a building's way along it is more than DETOUR times its shortest way
   * along the streets from `st` (plus DETOUR_M), the worst one is fed by its shortest way instead (the tree's own
   * streets taken where they are at most REUSE longer), and the ends that then reach no building are cut. */
  const bounded = (st: number, terms: Set<number>, tree: Int32Array) => {
    const parent = Int32Array.from(tree);
    const dist = new Float64Array(V).fill(Infinity);
    dist[st] = 0;
    spread(adjM, dist, new Int32Array(V), [st]); // the shortest way in metres, as the tree's own (a footpath's weight is no metre)
    const along = new Float64Array(V);
    const known = new Uint8Array(V);
    /** v's way along the tree to st, m (memoised in along until the tree changes). */
    const alongOf = (v: number) => {
      const path: number[] = [];
      let u = v;
      while (u !== st && !known[u]) {
        path.push(u);
        u = parent[u];
      }
      let d = u === st ? 0 : along[u];
      for (let i = path.length - 1; i >= 0; i--) {
        d += len(path[i], parent[path[i]]);
        along[path[i]] = d;
        known[path[i]] = 1;
      }
      return v === st ? 0 : along[v];
    };
    const kids = new Int32Array(V);
    for (let u = 0; u < V; u++) if (parent[u] >= 0) kids[parent[u]]++;
    for (let n = 0; n < terms.size; n++) {
      known.fill(0);
      let worst = -1;
      let excess = 0;
      for (const t of terms) {
        const x = t === st ? 0 : alongOf(t) - DETOUR * dist[t] - DETOUR_M;
        if (x > excess) [worst, excess] = [t, x];
      }
      if (worst < 0) break;
      // its way from st, the tree's streets a little cheaper: it runs on them where they are nearly as short
      const d = new Float64Array(V).fill(Infinity);
      const way = new Int32Array(V).fill(-1);
      const heap = new Heap();
      d[st] = 0;
      heap.push(0, st);
      while (heap.size) {
        const [du, u] = heap.pop();
        if (u === worst) break;
        if (du > d[u]) continue;
        for (let i = 0; i < adjW[u].length; i += 2) {
          const v = adjW[u][i];
          const nd = du + adjW[u][i + 1] * (parent[v] === u || parent[u] === v ? 1 : 1 + REUSE);
          if (nd < d[v]) {
            d[v] = nd;
            way[v] = u;
            heap.push(nd, v);
          }
        }
      }
      // its way joins the tree; a node it leaves that then feeds nothing is cut, and so on up
      const ends: number[] = [];
      for (let u = worst; u !== st; u = way[u]) {
        const old = parent[u];
        if (old === way[u]) continue;
        parent[u] = way[u];
        kids[way[u]]++;
        if (old >= 0 && !--kids[old] && old !== st && !terms.has(old)) ends.push(old);
      }
      while (ends.length) {
        const u = ends.pop()!;
        const up = parent[u];
        parent[u] = -1;
        if (up >= 0 && !--kids[up] && up !== st && !terms.has(up)) ends.push(up);
      }
    }
    return parent;
  };
  /** The shorter tree joining `chosen` to `st`: the grown one or Mehlhorn's, both cleaned up; then without the long
   * ways round. */
  const shortest = (st: number, chosen: number[], grown: Int32Array) => {
    const terms = new Set([st, ...chosen.map(join)]);
    const a = spanning(treeOf(st, chosen, grown).order, terms, st);
    if (terms.size < 3) return a.parent;
    const b = mehlhorn(terms, st);
    return bounded(st, terms, b.m < a.m - 1e-6 ? b.parent : a.parent);
  };

  /** `chosen` without the branches (and service pipes) that carry less than minDensity MWh per m: cut children first. */
  const prune = (st: number, chosen: number[], parent: Int32Array): number[] => {
    if (minDensity <= 0) return chosen;
    const worth = chosen.filter((b) => buildings[b].annualMwh >= minDensity * service(b));
    const { order, at } = treeOf(st, worth, parent);
    const A = new Float64Array(V);
    const L = new Float64Array(V);
    const cut = new Uint8Array(V);
    for (let i = order.length - 1; i > 0; i--) {
      const v = order[i];
      for (const b of at.get(v) ?? []) [A[v], L[v]] = [A[v] + buildings[b].annualMwh, L[v] + service(b)];
      const branch = L[v] + len(v, parent[v]);
      if (A[v] < minDensity * branch) cut[v] = 1;
      else [A[parent[v]], L[parent[v]]] = [A[parent[v]] + A[v], L[parent[v]] + branch];
    }
    return worth.filter((b) => {
      for (let u = join(b); u !== st; u = parent[u]) if (cut[u]) return false;
      return true;
    });
  };

  /** The plan from station `st`: grow, the shortest tree, the thin branches cut; again without them while some are,
   * and with the losses of the metres the tree without its long ways round added (the data center's share holds; not
   * for `quick`, a station only tried). */
  const planAt = (st: number, quick = false) => {
    const out = new Uint8Array(B);
    let extraM = 0;
    for (let round = 1; ; round++) {
      const grown = grow(st, out, extraM);
      const parent = shortest(st, grown.chosen, grown.parent);
      const kept = prune(st, grown.chosen, parent);
      const longer = treeM(st, grown.chosen, parent) + grown.chosen.reduce((a, b) => a + service(b), 0) - grown.metres;
      const holds = quick || longer <= 1e-6 || grown.holds(grown.metres + longer);
      if ((kept.length === grown.chosen.length && holds) || round === ROUNDS) return { chosen: kept, parent };
      const keep = new Set(kept);
      for (const b of grown.chosen) if (!keep.has(b)) out[b] = 1;
      extraM = Math.max(extraM, longer);
    }
  };

  // the data center's outline's point nearest street node `st` (its source point without an outline)
  const dcEnd = (st: number): [number, number] => {
    const ring = rings[0];
    const rxy = ringXy[0];
    if (!ring || !rxy) return [source.lat, source.lon];
    let best: [number, number] = ring[0];
    let bestD = Infinity;
    for (let i = 1; i < rxy.length; i++) {
      const [[ax, ay], [bx, by]] = [rxy[i - 1], rxy[i]];
      const [ex, ey] = [bx - ax, by - ay];
      const e2 = ex * ex + ey * ey;
      const u = e2 ? Math.min(1, Math.max(0, ((x[st] - ax) * ex + (y[st] - ay) * ey) / e2)) : 0;
      const d = hyp(ax + u * ex - x[st], ay + u * ey - y[st]);
      if (d < bestD) [best, bestD] = [[ring[i - 1][0] + u * (ring[i][0] - ring[i - 1][0]), ring[i - 1][1] + u * (ring[i][1] - ring[i - 1][1])], d];
    }
    return best;
  };
  const straightM = (v: number) => {
    const [la, lo] = dcEnd(v);
    return distanceM({ lat: la, lon: lo }, { lat: lat[v], lon: lon[v] });
  };
  /** The transmission line to station `st`, data center first: straight across the grounds to the street point (at
   * most GROUNDS_M away) from which the way along the streets to the station is shortest; the station itself when it
   * is within the grounds' reach (one straight line). ponytail: across the grounds as the crow flies. */
  const trans = (st: number): { m: number; line: [number, number][]; nodes: number[]; far?: boolean } => {
    const d = new Float64Array(V).fill(Infinity);
    const via = new Int32Array(V).fill(-1);
    d[st] = 0;
    spread(adj, d, via, [st]);
    // the station within the grounds' reach first: another street point must be shorter by half a metre (a tie, as
    // along a straight street, keeps the one straight line)
    const sst = straightM(st);
    let exit = sst <= GROUNDS_M ? st : -1;
    let best = exit < 0 ? Infinity : sst - 0.5;
    const near = GROUNDS_M + radius[0];
    for (let v = 0; v < V; v++) {
      if (v === st || d[v] === Infinity || hyp(x[v], y[v]) > near) continue;
      const s = straightM(v);
      if (s <= GROUNDS_M && s + d[v] < best) [exit, best] = [v, s + d[v]];
    }
    if (exit < 0) return { m: straightM(st), line: [dcEnd(st), pt(st)], nodes: [st], far: true }; // no street within the grounds: straight
    const line: [number, number][] = [dcEnd(exit)];
    const nodes: number[] = [];
    // its metres: across the grounds, then each piece of street its own length (the way is chosen on adj's weighted
    // metres, where a footpath counts 1.3 times)
    let m = straightM(exit);
    for (let v = exit; ; v = via[v]) {
      line.push(pt(v));
      if (nodes.length) m += len(nodes[nodes.length - 1], v);
      nodes.push(v);
      if (v === st) break;
    }
    return { m, line, nodes };
  };

  // the station: the caller's, else the place on the way from the data center to the load's centre (STATION_TRIES of
  // them) whose network needs the least pipe per MWh supplied; on a tie the one nearer the load (less of the hot pipe,
  // which loses more heat than the warm transmission line)
  let station = stationGiven;
  let plan: ReturnType<typeof planAt> | null = null;
  if (station < 0) {
    const w = reach.map((b) => buildings[b].annualMwh);
    const sw = w.reduce((a, b) => a + b, 0) || 1;
    const [cx, cy] = [0, 1].map((d) => reach.reduce((a, b, i) => a + w[i] * (d ? y : x)[join(b)], 0) / sw);
    let centre = dc;
    for (let v = 0; v < V; v++) if (distDc[v] < Infinity && hyp(x[v] - cx, y[v] - cy) < hyp(x[centre] - cx, y[centre] - cy)) centre = v;
    const way = [centre];
    while (way[way.length - 1] !== dc) way.push(viaDc[way[way.length - 1]]);
    way.reverse();
    const tries = [...new Set(Array.from({ length: STATION_TRIES }, (_, i) => way.find((v) => distDc[v] >= (distDc[centre] * i) / (STATION_TRIES - 1))!))];
    let bestCost = Infinity;
    for (const st of tries) {
      const p = planAt(st, true);
      const annual = p.chosen.reduce((a, b) => a + buildings[b].annualMwh, 0);
      const m = trans(st).m + treeM(st, p.chosen, p.parent) + p.chosen.reduce((a, b) => a + service(b), 0);
      const cost = annual > 0 ? m / annual : Infinity;
      if (!plan || cost <= bestCost * (1 + 1e-9)) [station, plan, bestCost] = [st, p, cost];
    }
  }
  let { chosen, parent } = planAt(station);
  // a station placed here whose line runs on along its own pipes (that street would carry both, out and back): moved
  // to where the line first meets them
  for (let k = 0; k < 3 && stationGiven < 0 && chosen.length; k++) {
    const tree = new Set(treeOf(station, chosen, parent).order);
    const meet = trans(station).nodes.find((v) => v !== station && tree.has(v));
    if (meet === undefined) break;
    station = meet;
    ({ chosen, parent } = planAt(station));
  }
  // the buildings beyond the station's reach along the streets
  if (reachM < Infinity) {
    const d = new Float64Array(V).fill(Infinity);
    d[station] = 0;
    spread(adjM, d, new Int32Array(V), [station]);
    const isIn = new Set(chosen);
    for (const b of reach)
      if (!isIn.has(b) && d[join(b)] > reachM)
        unreached.push({ id: buildings[b].id, reason: `${Math.round(d[join(b)])} m along the streets from the station, beyond its reach of ${Math.round(reachM)} m` });
  }

  // the pipes: the distribution tree as runs between its branchings, each with what it serves
  const { order, kids, at } = treeOf(station, chosen, parent);
  const P = new Float64Array(V);
  const A = new Float64Array(V);
  const N = new Float64Array(V);
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i];
    for (const b of at.get(v) ?? []) [P[v], A[v], N[v]] = [P[v] + buildings[b].peakKw, A[v] + buildings[b].annualMwh, N[v] + 1];
    if (i) [P[parent[v]], A[parent[v]], N[parent[v]]] = [P[parent[v]] + P[v], A[parent[v]] + A[v], N[parent[v]] + N[v]];
  }
  const carries = (v: number) => ({ peakKw: P[v] * simultaneity(N[v]), annualMwh: A[v], buildings: N[v] });
  const isBreak = (v: number) => v === station || at.has(v) || (kids.get(v)?.length ?? 0) !== 1;
  const pipes: Pipe[] = [];
  let warning: string | null = null;
  if (chosen.length) {
    const t = trans(station);
    // planned and costed as drawn, but no real line: it would follow streets the plan does not have
    if (t.far)
      warning = `The transmission line runs ${fmt(t.m)} m in a straight line: no street is within ${GROUNDS_M} m of the data center. A real line follows the streets and is longer: its metres, cost and loss here are too low.`;
    if (t.m > 0) pipes.push({ kind: "transmission", line: t.line, m: t.m, ...carries(station), served: chosen.map((_, i) => i) });
  }
  const runOf = new Map<number, Pipe>(); // each run by its downstream node
  for (const v of order.slice(1))
    if (isBreak(v)) {
      const run = [v];
      let m = 0;
      do {
        m += len(run[run.length - 1], parent[run[run.length - 1]]);
        run.push(parent[run[run.length - 1]]);
      } while (!isBreak(run[run.length - 1]));
      const pipe: Pipe = { kind: "distribution", line: run.reverse().map(pt), m, ...carries(v), served: [] };
      runOf.set(v, pipe);
      pipes.push(pipe);
    }
  chosen.forEach((b, i) => {
    for (let u = join(b); u !== station; u = parent[u]) runOf.get(u)?.served.push(i);
  });
  chosen.forEach((b, i) => {
    const { peakKw, annualMwh, id } = buildings[b];
    pipes.push({ kind: "service", line: [pt(join(b)), picked[b + 1]!.q], m: service(b), peakKw, annualMwh, buildings: 1, served: [i], id });
  });

  const m = { transmission: 0, distribution: 0, service: 0 };
  for (const p of pipes) m[p.kind] += p.m;
  // the station's heat pump on the chosen buildings' year, with the hot pipes' losses estimated
  const year = new Float64Array(YEAR_H);
  for (const b of chosen) for (let h = 0; h < YEAR_H; h++) year[h] += profile[b][h];
  const yearPeakKw = year.reduce((a, v) => Math.max(a, v), 0);
  const peakKw = P[station] * simultaneity(N[station]);
  const loss = (LOSS_W_PER_M * (m.distribution + m.service)) / 1000;
  const made = chosen.reduce((a, b) => a + kwh[b], 0) + loss * YEAR_H;
  const coveredBy = (kw: number) => {
    let c = 0;
    for (let h = 0; h < YEAR_H; h++) {
      const v = year[h] + loss;
      c += v < kw ? v : kw;
    }
    return c;
  };
  // the heat pump: a share of the peak hour, larger where the data center's share of the year needs it (a flat load,
  // a high share asked), at most what the data center allows; or for the whole design peak
  // (the whole peak: the larger of the design peak and the peak hour with the pipes' losses, whose profiles share one
  // weather: the simultaneity on top of their peaks would leave the boiler running in the coldest hours)
  const hpKw = !chosen.length
    ? 0
    : fullPeak
      ? Math.min(capacityKw, Math.max(peakKw, yearPeakKw + loss))
      : useAll
        ? Math.min(capacityKw, yearPeakKw)
        : heatPumpKw(year, loss, capacityKw, hpShare, minDcShare);
  const covered = coveredBy(hpKw);
  const annual = A[station];
  // the distribution pipe's streets: their heat line density, weighted by its metres under each
  let densM = 0;
  let densSum = 0;
  if (dens)
    for (const v of order.slice(1)) {
      const m = len(v, parent[v]);
      densM += m;
      densSum += m * (edgeDens.get(Math.min(v, parent[v]) * V + Math.max(v, parent[v])) ?? 0);
    }
  return {
    station: { lat: lat[station], lon: lon[station] },
    chosen: chosen.map((b) => buildings[b].id),
    pipes,
    m,
    totalM: m.transmission + m.distribution + m.service,
    annualMwh: annual,
    peakKw,
    yearPeakKw,
    hpKw,
    dcShare: made > 0 ? covered / made : 0,
    density: m.distribution + m.service > 0 ? annual / (m.distribution + m.service) : 0,
    streetDensity: dens ? (densM > 0 ? densSum / densM : 0) : null,
    unreached,
    problem: null,
    warning,
  };
}
