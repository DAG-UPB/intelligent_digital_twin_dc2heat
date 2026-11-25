/** Snapping, sensor taps, arcs, slider stages and the circle morph. */
import { expect, test } from "vitest";
import { arc, arcMid, circleMorph, H, layoutArcs, nameAbove, R, snap, stageOf, tapFor, W } from "./geometry";

test("snap to the 10 px grid", () => {
  expect(snap(14)).toBe(10);
  expect(snap(15)).toBe(20);
});

test("an instrument whose tap runs down through its name gets the name above", () => {
  expect(nameAbove("HVAC_Ener", 780, 225)).toBe(true); // straight down onto the chiller
  expect(nameAbove("HEX_Hall_m", 500, 70)).toBe(true); // steeply down onto the hall HEX
  expect(nameAbove("HEX_Cond_m", 830, 450)).toBe(false); // taps up: the name below stays clear
  expect(nameAbove("Cool_Set", 485, 395)).toBe(false); // sideways
  expect(nameAbove("Out_Temp", 90, 70)).toBe(false); // no tap
});

test("sensor taps go to the equipment a variable measures, never to a pipe", () => {
  expect(tapFor("HEX_Cond_T_in", 860, 230)).toEqual([880, 308]); // the condenser HEX, though the chiller is nearer
  expect(tapFor("HEX_Hall_m", 500, 70)).toEqual([555, 150]); // the hall HEX
  expect(tapFor("HEX_Cond_m", 790, 440)).toEqual([880, 332]); // the condenser HEX, from below
  expect(tapFor("HVAC_Ener", 780, 225)).toEqual([780, 280]); // the chiller's electricity: onto the chiller
  expect(tapFor("Cool_Set", 485, 395)).toEqual([520, 395]); // the CRAH keeps its set-point
  expect(tapFor("Heat_Demand", 1060, 180)).toBeNull(); // the demand: no tap
  expect(tapFor("IT_Load", 270, 470)).toEqual([270, 380]); // the nearest rack row
  expect(tapFor("In_Temp", 160, 450)).toBeNull(); // room air: no tap even right next to a rack
  expect(tapFor("Out_Temp", 90, 70)).toBeNull(); // weather
  expect(tapFor("Unknown", 650, 250)).toEqual([630, 250]); // unknown: nearest unit (CRAH) within reach
  expect(tapFor("Unknown", 1000, 600)).toBeNull(); // ... and none when far from everything
});

test("arc ends sit on the bubble edges; the label at the curve middle", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 200, y: 0 };
  const [s, c, e] = arc(a, b, 0);
  expect(Math.hypot(s[0], s[1])).toBeCloseTo(R);
  expect(Math.hypot(e[0] - 200, e[1])).toBeCloseTo(R + 1);
  expect(c[1]).toBeCloseTo(36); // bent clockwise by 0.18 x distance
  expect(arcMid([[0, 0], [10, 20], [20, 0]])).toEqual([10, 10]);
  // smaller bubbles: the line still starts and ends on their edges, not at R
  const [s2, , e2] = arc(a, b, 0, 0.4 * R, 0.6 * R);
  expect(Math.hypot(s2[0], s2[1])).toBeCloseTo(0.4 * R);
  expect(Math.hypot(e2[0] - 200, e2[1])).toBeCloseTo(0.6 * R + 1);
});

test("layoutArcs ends each line on its own bubble's radius", () => {
  const at = { A: { x: 0, y: 0 }, B: { x: 300, y: 0 } };
  const { arcs } = layoutArcs([{ from: "A", to: "B", lags: [1] }], at, (v) => (v === "A" ? 5 : 9));
  expect(Math.hypot(arcs[0].pts[0][0], arcs[0].pts[0][1])).toBeCloseTo(5);
  expect(Math.hypot(arcs[0].pts[2][0] - 300, arcs[0].pts[2][1])).toBeCloseTo(10);
});

test("slider stages", () => {
  expect(stageOf(0)).toEqual({ t: 0, pull: 0 });
  expect(stageOf(0.5)).toEqual({ t: 1, pull: 0 });
  expect(stageOf(1)).toEqual({ t: 1, pull: 1 });
});

test("circle morph keeps positions at 0 and puts every one on the circle at 1, in angular order", () => {
  const pos: Record<string, { x: number; y: number; tag: string }> = { A: { x: 100, y: 100, tag: "" }, B: { x: 900, y: 120, tag: "" }, C: { x: 500, y: 600, tag: "" } };
  const vars = ["A", "B", "C"];
  expect(circleMorph(pos, vars, 0, H)).toBe(pos);
  const out = circleMorph(pos, vars, 1, H);
  for (const v of vars) expect(Math.hypot(out[v].x - W / 2, out[v].y - H / 2)).toBeCloseTo(0.4 * Math.min(W, H));
  const ang = (v: string) => Math.atan2(out[v].y - H / 2, out[v].x - W / 2);
  const before = (v: string) => Math.atan2(pos[v].y - 273.33, pos[v].x - 500);
  expect([...vars].sort((u, v) => ang(u) - ang(v))).toEqual([...vars].sort((u, v) => before(u) - before(v)));
});

test("arcs: only placed links, receivers in name order, inputs fanned out", () => {
  const at = { A: { x: 0, y: 0 }, B: { x: 300, y: 0 }, C: { x: 300, y: 300 } };
  const links = [
    { from: "A", to: "C", lags: [1] },
    { from: "B", to: "C", lags: [1] },
    { from: "C", to: "B", lags: [1] },
    { from: "A", to: "Z", lags: [1] },
  ];
  const { arcs, receivers } = layoutArcs(links, at);
  expect(arcs.map((a) => a.key)).toEqual(["A->C", "B->C", "C->B"]);
  expect(receivers).toEqual(["B", "C"]);
  expect(arcs[0].pts[2]).not.toEqual(arc(at.A, at.C, 0)[2]); // two inputs into C: turned apart
});
