import { expect, test } from "vitest";
import { CO2_T_PER_M3, FIELD_HA, FIELD_M, FOREST_CO2_T_PER_HA, FOREST_TREES_PER_HA, MAX_ICONS, STADTWALD_CENTRE, TREE_KG_PER_YEAR, WOOD, fieldBlock, fieldsFor, forestOf, grove, homesLine, nearFrankfurt, roughly, treesFor, treesPerIcon } from "./trees";

test("a hectare of Hessian forest takes up its growth's CO₂, shared by its trees", () => {
  expect(WOOD.growthM3).toBe(8.9); // m³ of wood a hectare grows a year
  expect(CO2_T_PER_M3).toBe(1.4);
  expect(FOREST_CO2_T_PER_HA).toBeCloseTo(12.46, 9); // t a year: 8.9 m³ grown at 1.4 t CO₂ each
  expect(TREE_KG_PER_YEAR).toBe(20); // a grown tree, the middle of the estimates
  expect(FOREST_TREES_PER_HA).toBeCloseTo(623, 9); // 12.46 t ÷ 20 kg
  // the trees of a hectare's uptake are a hectare's trees: the grove and the forest agree
  expect(treesFor(FOREST_CO2_T_PER_HA)).toBeCloseTo(FOREST_TREES_PER_HA, 9);
  expect(forestOf(treesFor(2750)).ha).toBeCloseTo(2750 / FOREST_CO2_T_PER_HA, 9); // ≈ 221 ha, not 500 at 5.5 t a ha
});

test("CO₂ becomes trees; nothing saved, no trees", () => {
  expect(treesFor(TREE_KG_PER_YEAR / 1000)).toBeCloseTo(1, 9);
  expect(treesFor(20)).toBeCloseTo(1000, 9);
  expect(treesFor(-3)).toBe(0);
  expect(treesFor(NaN)).toBe(0);
});

test("the headline: whole trees below 100, two significant digits above", () => {
  expect(roughly(7.4)).toBe(7);
  expect(roughly(99.4)).toBe(99);
  expect(roughly(12_437)).toBe(12_000);
  expect(roughly(1_284)).toBe(1_300);
});

test("one icon is a round number of trees, never more than the window holds", () => {
  expect(treesPerIcon(7)).toBe(1);
  expect(treesPerIcon(41)).toBe(2);
  expect(treesPerIcon(12_437)).toBe(500);
  for (const t of [1, 39, 40, 41, 999, 123_456]) expect(t / treesPerIcon(t)).toBeLessThanOrEqual(MAX_ICONS);
});

test("the grove: full icons and a sapling for the rest; its icons add up to the trees", () => {
  const g = grove(12_437 * TREE_KG_PER_YEAR / 1000);
  expect(g.per).toBe(500);
  expect(g.icons).toHaveLength(25);
  expect(g.icons.at(-1)).toBeCloseTo(0.874, 3);
  expect(g.icons.reduce((a, b) => a + b, 0) * g.per).toBeCloseTo(g.trees, 6);
  expect(grove(0).icons).toEqual([]);
  expect(grove(-1).trees).toBe(0);
});

test("the forest of the trees: hectares and a circle of that area", () => {
  const f = forestOf(130_000);
  expect(f.ha).toBeCloseTo(130_000 / FOREST_TREES_PER_HA, 9);
  expect(Math.PI * f.radiusM ** 2).toBeCloseTo(f.ha * 1e4, 3); // 1 ha = 10,000 m²
  expect(forestOf(-5)).toEqual({ ha: 0, radiusM: 0 });
});

test("soccer fields: 105 × 68 m, 0.714 ha each", () => {
  expect(FIELD_HA).toBeCloseTo(0.714, 9);
  expect(fieldsFor(71.4)).toBeCloseTo(100, 9);
  expect(fieldsFor(-1)).toBe(0);
});

test("the block: fields side by side in a near-square, in metres from the centre", () => {
  const c = STADTWALD_CENTRE;
  const b = fieldBlock(700, c);
  expect(b.cols).toBe(21); // √(700 × 68 / 105) ≈ 21.3
  expect(b.fields).toHaveLength(700);
  expect(b.lines).toHaveLength(700 * 4); // halfway line, centre circle, two penalty areas
  // a field is 105 m east by 68 m north: degrees of latitude 111.32 km, of longitude that times cos(latitude)
  const [nw, ne, , sw] = b.fields[0];
  const mLon = 111_320 * Math.cos((c[0] * Math.PI) / 180);
  expect((ne[1] - nw[1]) * mLon).toBeCloseTo(FIELD_M.long, 6);
  expect((nw[0] - sw[0]) * 111_320).toBeCloseTo(FIELD_M.wide, 6);
  // the next field east of the first, the next row below; the block centred on the centre and near square
  expect(b.fields[1][0][1]).toBeCloseTo(ne[1], 9);
  expect(b.fields[21][0][0]).toBeCloseTo(sw[0], 9);
  const [[s, w], [n, e]] = b.bounds;
  expect((s + n) / 2).toBeCloseTo(c[0], 9);
  expect((w + e) / 2).toBeCloseTo(c[1], 9);
  const ratio = ((e - w) * mLon) / ((n - s) * 111_320);
  expect(ratio).toBeGreaterThan(0.9);
  expect(ratio).toBeLessThan(1.1);
});

test("the block: the last field cut to its share; above the cap one area of their size", () => {
  const b = fieldBlock(2.5, STADTWALD_CENTRE);
  expect(b.fields).toHaveLength(3);
  expect(b.lines).toHaveLength(2 * 4); // no lines on the half field
  const w = (f: [number, number][]) => f[1][1] - f[0][1];
  expect(w(b.fields[2]) / w(b.fields[0])).toBeCloseTo(0.5, 9);
  expect(fieldBlock(0, STADTWALD_CENTRE).fields).toEqual([]);

  const big = fieldBlock(10_000, STADTWALD_CENTRE, 2500);
  expect(big.one).toBe(true);
  expect(big.fields).toHaveLength(1);
  expect(big.lines).toEqual([]);
  const [[s, west], [n, e]] = big.bounds;
  const mLon = 111_320 * Math.cos((STADTWALD_CENTRE[0] * Math.PI) / 180);
  expect(((e - west) * mLon * (n - s) * 111_320) / 1e4).toBeCloseTo(10_000 * FIELD_HA, 3); // the area of all the fields
});

test("nearFrankfurt: the Stadtwald for a site in or by Frankfurt, not for another city", () => {
  expect(nearFrankfurt(50.108981, 8.703079)).toBe(true); // the example's data center, Ostend
  expect(nearFrankfurt(50.0, 8.27)).toBe(false); // Mainz, ~31 km
  expect(nearFrankfurt(52.52, 13.405)).toBe(false); // Berlin
});

// K16: "the heat for ≈ 2,544 households" beside the heat network's "Apartments supplied 2,391" read as two counts of one thing
test("the delivered heat in households is an equivalent at 9 MWh each, said so: not the network's apartments supplied", () => {
  expect(homesLine(22_899, 2514)).toBe("as much heat as ≈ 2.544 average households use (9 MWh a year each; ≈ 5.089 people) · 15,3 million showers a year");
});
