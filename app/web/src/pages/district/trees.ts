/**
 * The Quick analysis's grove (TreeGrove.tsx): the CO₂ the heat recovery saves in a year as the number of trees that
 * take up as much in a year, drawn as a small grove of icons, one icon for a round number of trees; the forest they
 * would make, drawn on the Site map in the Frankfurter Stadtwald as soccer fields side by side. Pure.
 */
import { fmt } from "../../lib/format";
import { HOUSEHOLD_MWH, heatFacts, TREE_KG } from "../../lib/heatFacts";

/**
 * The forest, per hectare, in Hessen: 8.9 m³ of wood growing a year (Vorratsfestmeter, stem wood over 7 cm with bark;
 * Bundeswaldinventur 2022, "BWI4 Daten Hessen", Hessian ministry of forests, 2024); its growth takes up the CO₂
 * (FOREST_CO2_T_PER_HA).
 */
export const WOOD = { growthM3: 8.9 };

/**
 * t CO₂ a hectare of forest takes up in a year by growing: the 8.9 m³ of wood it grows (WOOD) at "about 1.4 t of CO₂
 * for each cubic metre" (BWI4 Daten Hessen, ch. 3, see WOOD), 12.5 t. The 1.4 is the whole tree's: a m³ of the
 * Stadtwald's oak, ash, maple and pine is some 0.52 t of dry wood (IPCC 2006 Guidelines, vol. 4, table 4.14), half of
 * it carbon, 0.96 t of CO₂ (× 44/12); branches and roots add the rest (roots alone 20–30 % of the tree above ground,
 * ibid. table 4.4). The growth and not the net balance: Hessen's forest lost more wood than it grew in 2012–2022
 * (drought, dying spruce; BWI4 Daten Hessen), and an uptake below zero makes no forest. Approximate.
 */
export const CO2_T_PER_M3 = 1.4;
export const FOREST_CO2_T_PER_HA = WOOD.growthM3 * CO2_T_PER_M3;
/**
 * kg CO₂ a tree takes up in a year: 20, the same as heatFacts' TREE_KG, the middle of the estimates per tree (about
 * 12.5 for a grown beech, Wald-Zentrum, Universität Münster; ~22, Arbor Day Foundation; ~29 for a beech, Stiftung
 * Unternehmen Wald). The hectare's uptake above is the firmer number, so the trees per hectare follow from the two
 * (FOREST_TREES_PER_HA, about 620: grown trees). Approximate.
 */
export const TREE_KG_PER_YEAR = TREE_KG;
export const FOREST_TREES_PER_HA = (FOREST_CO2_T_PER_HA * 1000) / TREE_KG_PER_YEAR;
export const TREE_SOURCE =
  "about 20 kg of CO₂ a year for a grown tree, the middle of the estimates per tree (about 10 to 30 kg; a grown beech about 12.5 kg, Wald-Zentrum, Universität Münster)";
export const FOREST_SOURCE =
  "a hectare of Hessian forest grows 8.9 m³ of wood a year, about 1.4 t of CO₂ each (Bundeswaldinventur 2022, Hessen): 12.5 t a year, about as much as 620 trees take up";
export const MAX_ICONS = 40; // two rows of twenty fit the window's width

/** The trees that take up `co2T` t of CO₂ in a year; 0 when nothing is saved (more grid CO₂ than gas avoided). */
export const treesFor = (co2T: number) => (Number.isFinite(co2T) && co2T > 0 ? (co2T * 1000) / TREE_KG_PER_YEAR : 0);

/** A headline number: whole numbers below 100, else two significant digits (the factors are no more precise than that). */
export function roughly(x: number): number {
  if (x < 100) return Math.round(x);
  const step = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / step) * step;
}

/** Trees per icon: the smallest of 1, 2, 5, 10, 20, 50 … that draws `trees` in at most `max` icons. */
export function treesPerIcon(trees: number, max = MAX_ICONS): number {
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) if (trees <= m * p * max) return m * p;
}

/** The grove of `co2T` t a year: the trees, the headline, trees per icon, and each icon's size (1 full, the last a sapling). */
export function grove(co2T: number, max = MAX_ICONS) {
  const trees = treesFor(co2T);
  const per = trees > 0 ? treesPerIcon(trees, max) : 1;
  const n = trees / per;
  const full = Math.floor(n);
  const rest = n - full;
  // the last, unfinished icon a sapling of its share; one too small to see is left out
  const icons = [...new Array<number>(full).fill(1), ...(rest >= 0.05 ? [rest] : [])];
  return { trees, shown: roughly(trees), per, icons };
}

/**
 * Where the forest is drawn: in the Stadtwald's Sachsenhausen part, south of Sachsenhausen and Oberrad (OSM's
 * "Frankfurter Stadtwald", relation 48493), between the Darmstädter and the Babenhäuser Landstraße and the A3 (OSM
 * roads): a block of up to some 190 ha stays clear of them, a bigger one crosses them as the forest's roads do.
 */
export const STADTWALD_CENTRE: [number, number] = [50.0705, 8.7044];
/** Whether a place is in or by Frankfurt (within 25 km of the Stadtwald): its forest is drawn there, locally. */
export const nearFrankfurt = (lat: number, lon: number) => Math.hypot(lat - STADTWALD_CENTRE[0], (lon - STADTWALD_CENTRE[1]) * Math.cos((lat * Math.PI) / 180)) * 111.32 < 25;
/** The Stadtwald's forest: about 4,800 ha (City of Frankfurt, Waldzustandsbericht 2024: about 6,000 ha, 1,200 of them in the Taunus). */
export const STADTWALD_HA = 4800;

/** The forest of `trees` trees: its area (ha) and a circle of that area (radius in m). */
export function forestOf(trees: number) {
  const ha = Math.max(0, trees) / FOREST_TREES_PER_HA;
  return { ha, radiusM: Math.sqrt((ha * 1e4) / Math.PI) };
}

/**
 * A soccer field: 105 × 68 m, 0.714 ha, the pitch FIFA recommends (FIFA, Football Stadiums: Technical Recommendations
 * and Requirements; the IFAB's Laws of the Game, Law 1, allow 100–110 × 64–75 m for international matches). Its lines
 * by Law 1: the centre circle of 9.15 m and the penalty areas 16.5 m deep, 40.32 m wide.
 */
export const FIELD_M = { long: 105, wide: 68, circle: 9.15, boxDeep: 16.5, boxWide: 40.32 };
export const FIELD_HA = (FIELD_M.long * FIELD_M.wide) / 1e4;
export const FIELD_SOURCE = "a soccer field of 105 × 68 m (0.714 ha), the pitch FIFA recommends";
/** More fields than this are drawn as one area of their size: the map stays quick, and so many fit no forest anyway. */
export const MAX_FIELDS = 2500;

/** The soccer fields `ha` of forest make. */
export const fieldsFor = (ha: number) => Math.max(0, ha) / FIELD_HA;

type LatLon = [number, number];
const M_PER_DEG = 111_320; // metres per degree of latitude; of longitude, times cos(latitude)

/**
 * `n` soccer fields side by side in a near-square block centred on `centre`, rows from the north, the long side east:
 * each field's outline (lat, lon) and, for the whole fields, its pitch lines (halfway line, centre circle, penalty
 * areas); the last field cut to its share. Above `max` fields, the block is one area of their size (`one`).
 */
export function fieldBlock(n: number, centre: LatLon, max = MAX_FIELDS) {
  const { long, wide } = FIELD_M;
  n = Math.max(0, n);
  const cols = Math.max(1, Math.round(Math.sqrt((n * wide) / long))); // as many 105 m across as 68 m rows down: square
  const one = n > max;
  const w = cols * long;
  const h = one ? (n / cols) * wide : Math.ceil(n / cols) * wide;
  const mLon = M_PER_DEG * Math.cos((centre[0] * Math.PI) / 180);
  const at = (x: number, y: number): LatLon => [centre[0] + y / M_PER_DEG, centre[1] + x / mLon]; // x east, y north, m
  const rect = (x: number, y: number, dx: number, dy: number): LatLon[] => [at(x, y), at(x + dx, y), at(x + dx, y - dy), at(x, y - dy)];
  const x0 = -w / 2; // the block's north-west corner
  const y0 = h / 2;
  const bounds: [LatLon, LatLon] = [at(x0, -y0), at(-x0, y0)]; // south-west, north-east
  if (one) return { cols, one, fields: [rect(x0, y0, w, h)], lines: [] as LatLon[][], bounds };
  const fields: LatLon[][] = [];
  const lines: LatLon[][] = [];
  const { circle, boxDeep, boxWide } = FIELD_M;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i % cols) * long;
    const y = y0 - Math.floor(i / cols) * wide;
    const share = Math.min(1, n - i);
    fields.push(rect(x, y, share * long, wide));
    if (share < 1) continue;
    const mx = x + long / 2;
    const my = y - wide / 2;
    const top = my + boxWide / 2;
    const bottom = my - boxWide / 2;
    lines.push(
      [at(mx, y), at(mx, y - wide)],
      Array.from({ length: 25 }, (_, k) => at(mx + circle * Math.cos((k * Math.PI) / 12), my + circle * Math.sin((k * Math.PI) / 12))),
      [at(x, top), at(x + boxDeep, top), at(x + boxDeep, bottom), at(x, bottom)],
      [at(x + long, top), at(x + long - boxDeep, top), at(x + long - boxDeep, bottom), at(x + long, bottom)],
    );
  }
  return { cols, one, fields, lines, bounds };
}

/** The year's heat delivered in everyday terms, for the forest's label: an equivalent (the heat ÷ an average
 * household's HOUSEHOLD_MWH), said as one, since the heat network on the same page counts the apartments of the
 * buildings it supplies (networkCost.ts apartments), another number. */
export function homesLine(heatMwh: number, co2T: number): string {
  const f = heatFacts(heatMwh, co2T);
  return `as much heat as ≈ ${fmt(f.households)} average households use (${fmt(HOUSEHOLD_MWH)} MWh a year each; ≈ ${fmt(f.people)} people) · ${fmt(f.showers / 1e6, 1)} million showers a year`;
}
