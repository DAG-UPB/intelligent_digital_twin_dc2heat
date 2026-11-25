/** The connection points' spots: beside the supply and the return of each side, the same heights as the drawings. */
import { expect, test } from "vitest";
import { DC_INTERFACE, districtPoint, heatPoints, WEATHER } from "../../heat/ports";
import { boundary, EDGE_X, NEIGHBOUR_X, PORT_Y, portSpots, portY, SIDES, stripSpots, weatherBox, weatherSpots, type StripVar } from "./connection";
import { DEFAULTS } from "./layout";
import { W } from "./geometry";

test("each structure's sides: the data center out, the heat distribution in and out, the district in", () => {
  expect(SIDES.dc.map((s) => s.side)).toEqual(["out"]);
  expect(SIDES.heat.map((s) => s.side)).toEqual(["in", "out"]);
  expect(SIDES.district.map((s) => s.side)).toEqual(["in"]);
});

test("the variables sit above the supply and below the return, on their side, apart", () => {
  const [from, to] = heatPoints((v) => v);
  const spots = portSpots({ in: from.vars, out: to.vars }, 640);
  expect(spots.T_dc_supply.y).toBeLessThan(PORT_Y[0]);
  expect(spots.T_dc_return.y).toBeGreaterThan(PORT_Y[1]);
  expect(spots.T_dc_supply.x).toBeLessThan(W / 2);
  expect(spots.T_dh_supply.x).toBeGreaterThan(W / 2);
  expect(spots.m_dh.tag).toBe("FT");
  expect([spots.m_dh.x, spots.m_dc.x]).toEqual([spots.T_dh_return.x, spots.T_dc_return.x]); // the flow under the return
  expect(spots.m_dh.y).toBeGreaterThan(spots.T_dh_return.y);
  const all = Object.values(spots);
  for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(60);
  // the district's water under the same names as the heat distribution's: one spot each
  expect(Object.keys(portSpots({ in: districtPoint("Q_houses").vars }, 640)).sort()).toEqual(["Q_houses", "T_dh_return", "T_dh_supply", "m_dh"]);
});

test("the data center's inputs and outputs under its connection point, in its margin, apart", () => {
  const more = DC_INTERFACE.map((x): [string, string] => [x.v, x.tag]);
  const spots = portSpots({ out: { t_supply: "T_in", t_return: "T_out" } }, 640, more);
  for (const [v] of more) expect(spots[v].y).toBeGreaterThan(spots.T_out.y + 60);
  expect(spots.Heat_rejected.tag).toBe("QT");
  for (const s of Object.values(spots)) expect(s.x).toBeGreaterThan(W); // the data center's margin: right of the picture
  const all = Object.values(spots);
  for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(60);
});

test("the weather's box above the neighbour's box on every structure, flush with its outer edge, the same slots", () => {
  const three: [string, string][] = [
    ["Out_Temp", "TT"],
    ["Out_Hum", "MT"],
    ["solar_radiation", "RT"],
  ];
  // beside a picture: in the margin, above the neighbour's box drawn there
  expect(weatherBox("dc", false)[0] + weatherBox("dc", false)[1]).toBe(NEIGHBOUR_X.out[0] + NEIGHBOUR_X.out[1]);
  expect(weatherBox("district", false)[0]).toBe(NEIGHBOUR_X.in[0]);
  // on the built-in drawings: above the heat distribution's box (x 1000 to 1096) and the data center's or the heat distribution's (from x 40)
  const [x0, w] = weatherBox("dc", true, 6);
  expect(x0 + w).toBe(1096);
  expect(weatherBox("heat", true, 4)[0]).toBe(40);
  for (const v of ["Out_Temp", "Out_Hum", "solar_radiation", "Out_Wind", "Out_Wind_Dir", "Hour"]) {
    const { x, y } = DEFAULTS[v];
    expect(x - 22 > x0 && x + 22 < x0 + w && y + 30 < 104).toBe(true);
  }
  // the same three slots, relative to the box, everywhere
  const rel = (scope: "dc" | "heat" | "district", drawn: boolean) => {
    const at = weatherSpots(scope, drawn, three);
    return Object.values(at).map((p) => [p.x - weatherBox(scope, drawn)[0], p.y]);
  };
  for (const [scope, drawn] of [
    ["dc", true],
    ["heat", false],
    ["district", true],
  ] as const)
    expect(rel(scope, drawn)).toEqual(rel("dc", false));
  expect(weatherSpots("dc", false, three).Out_Hum.tag).toBe("MT");
});

test("a picture too short for the drawings' heights has them further up", () => {
  expect(portY(640)).toEqual(PORT_Y);
  const [s, r] = portY(200);
  expect(r).toBeLessThan(200);
  expect(r - s).toBe(40);
});

test("an empty structure is the data center's box: its inputs and outputs above it, apart, its right edge the connection point", () => {
  const vars: StripVar[] = [
    ...WEATHER.map((w): StripVar => ({ v: w.v, tag: "TT", io: "input" })),
    ...DC_INTERFACE.map((x): StripVar => ({ v: x.v, tag: x.tag, io: x.io })),
  ];
  const spots = stripSpots(vars);
  const [bx, by, bw, bh] = boundary(640);
  for (const s of vars) expect(spots[s.v].y + 35).toBeLessThan(by); // above the box, its name too (its baseline R + 13 under the centre)
  expect(spots.IT_power.x).toBeGreaterThan(spots.IT_load.x); // the inputs first, then the outputs
  expect(spots.Heat_rejected.x + 22).toBeLessThan(W); // over the box, clear of the connection point's margin
  expect(bx + bw).toBe(EDGE_X.out); // the pipes start at its edge
  expect(by < PORT_Y[0] && PORT_Y[1] < by + bh).toBe(true);
  const all = Object.values(spots);
  for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(80);
  expect(boundary(2000)[1] + boundary(2000)[3]).toBe(1998); // a taller surface: the box goes down with it, its top stays
  expect(boundary(2000)[1]).toBe(by);
});
