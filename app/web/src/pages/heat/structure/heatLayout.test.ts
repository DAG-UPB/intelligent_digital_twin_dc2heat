import { expect, test } from "vitest";
import { framedTaps, H, R, tapFor, W } from "../../datacenter/structure/geometry";
import { DISTRICT_TAPS } from "../../district/structure/districtLayout";
import { HEAT_ACTUATORS, HEAT_DEFAULTS, HEAT_LINKS, HEAT_NOTES, HEAT_STARTER, HEAT_TAPS } from "./heatLayout";

test("the heat distribution's variables: on the drawing, apart from each other, the water on both sides", () => {
  const spots = Object.values(HEAT_DEFAULTS);
  for (const s of spots) expect(s.x >= R && s.x <= W - R && s.y >= R && s.y <= H - R).toBe(true);
  for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * R + 20);
  for (const v of ["Q_dc", "Q_demand", "T_dc_supply", "T_dc_return", "m_dc", "T_dh_supply", "T_dh_return", "m_dh"]) expect(HEAT_STARTER).toContain(v);
});

test("every variable taps onto the part it measures, close by, unless it is a part's own state or the weather", () => {
  for (const [v, what] of Object.entries(HEAT_TAPS.measures)) {
    expect(HEAT_DEFAULTS[v], v).toBeTruthy();
    if (what === null) continue;
    expect(HEAT_TAPS.units[what], v).toBeTruthy();
    const p = HEAT_DEFAULTS[v];
    const q = tapFor(v, p.x, p.y, HEAT_TAPS)!;
    expect(Math.hypot(q[0] - p.x, q[1] - p.y), v).toBeLessThan(120);
  }
  expect(Object.keys(HEAT_TAPS.measures).sort()).toEqual(HEAT_STARTER);
});

test("in the new form a margin instrument taps onto the nearest point of its pipe, at the box's edge", () => {
  const taps = framedTaps(HEAT_TAPS);
  expect(tapFor("T_dc_supply", -45, 138, taps)).toEqual([0, 198]); // the supply, where it enters the box
  expect(tapFor("m_dc", -45, 358, taps)).toEqual([0, 242]); // the return, from below
  expect(tapFor("Q_dc", -115, 560, taps)).toEqual([0, 242]); // the data center's box is gone: onto its nearest pipe
  expect(tapFor("T_dh_supply", W + 45, 138, taps)).toEqual([W, 198]);
  expect(tapFor("Q_demand", W + 45, 560, taps)).toEqual([W, 242]); // the district's box is gone too
  expect(tapFor("Q_dc", 110, 140, HEAT_TAPS)).toEqual([110, 160]); // the drawing on its own keeps the boxes
  expect(tapFor("T_dh_supply", -45, 138, framedTaps(DISTRICT_TAPS))).toEqual([0, 198]); // the district's, the same
});

test("the starting causal links join starting variables, one step back, each pair once", () => {
  const vars = new Set(HEAT_STARTER);
  for (const l of HEAT_LINKS) expect(vars.has(l.from) && vars.has(l.to) && l.lags.join() === "1", `${l.from} -> ${l.to}`).toBe(true);
  expect(new Set(HEAT_LINKS.map((l) => `${l.from}>${l.to}`)).size).toBe(HEAT_LINKS.length);
  // exogenous: caused by nothing
  for (const v of ["Q_dc", "m_dc", "T_outdoor"]) expect(HEAT_LINKS.some((l) => l.to === v)).toBe(false);
});

test("the heat pump's load is an actuator, 0 to 100 %, and drives the heat it delivers", () => {
  expect(HEAT_ACTUATORS).toEqual(["hp_load"]);
  expect(HEAT_STARTER).toContain("hp_load");
  expect(HEAT_NOTES.hp_load).toMatchObject({ kind: "actuator", note: expect.stringContaining("0 = off, 100 = full power") });
  expect(HEAT_LINKS).toContainEqual({ from: "hp_load", to: "Q_hp", lags: [1] });
});
