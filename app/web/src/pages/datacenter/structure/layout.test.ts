/** Instrument layout per diagram and its pid_layout encoding. */
import { describe, expect, test } from "vitest";
import {
  assignmentsFromLayout,
  PAPER,
  DEFAULTS,
  FC_DEFAULTS,
  diagramsToSave,
  encode,
  guessTag,
  layoutFor,
  plantLayoutEntries,
  spotForNewVar,
  traySlot,
} from "./layout";

test.each([
  ["HEX_Hall_Q", "QT"],
  ["In_Temp", "TT"],
  ["Out_Hum", "MT"],
  ["ITE_Ener", "EQ"],
  ["IT_Load", "JT"],
  ["Cool_Set", "TIC"],
  ["Pump_speed", "SC"],
  ["foo", "XT"],
  ["HEX_Cond_m", "FT"],
  ["HEX_Cond_T_in", "TT"],
  ["Heat_Demand", "QT"],
])("guessTag(%s) = %s", (v, tag) => expect(guessTag(v)).toBe(tag));

describe("paper diagram", () => {
  const trayTop = 500;
  const frame = { canDraw: false, trayTop };
  const pos = { A: { x: 110, y: 250, tag: "TT" }, B: { x: 70, y: 550, tag: "QT" } };

  test("encode: image fractions, the tray as x = -1", () => {
    expect(encode("paper", pos, trayTop)).toEqual({ "paper:A": { x: 0.1, y: 0.5, tag: "TT" }, "paper:B": { x: -1, y: -1, tag: "QT" } });
  });
  test("layoutFor restores placed ones; unplaced go to the tray in order", () => {
    const back = layoutFor("paper", ["A", "B", "C"], encode("paper", pos, trayTop), frame);
    expect(back.A).toEqual(pos.A);
    expect(back.B).toEqual({ ...traySlot(0, trayTop), tag: "QT" });
    expect(back.C).toEqual({ ...traySlot(1, trayTop), tag: "XT" });
  });
  test("a new variable takes the next tray slot", () => {
    expect(spotForNewVar("X_Temp", ["A", "B"], pos, true, frame)).toEqual({ ...traySlot(1, trayTop), tag: "TT" });
  });
});

describe("drawn diagram", () => {
  test("simulation: saved, then DEFAULTS, then the spare row", () => {
    const p = layoutFor("drawn", ["IT_Load", "In_Temp", "zz"], { In_Temp: { x: 1, y: 2, tag: "X" } }, { canDraw: true, trayTop: 0 });
    expect(p.IT_Load).toEqual(DEFAULTS.IT_Load);
    expect(p.In_Temp).toEqual({ x: 1, y: 2, tag: "X" });
    expect(p.zz).toEqual({ x: 540, y: 595, tag: "XT" });
  });
  test("no drawing: the connection points' variables at them (beside it), the tray from the top", () => {
    const p = layoutFor("drawn", ["IT_Load", "T_in"], {}, { canDraw: false, trayTop: 0, ports: { T_in: { x: 940, y: 155, tag: "TT" } } });
    expect(p.IT_Load).toEqual({ ...traySlot(0, 0), tag: "JT" });
    expect(p.T_in).toEqual({ x: 940, y: 155, tag: "TT" });
  });
  test("a paper P&ID: a connection point's variable at it until placed; one put back in the tray stays there", () => {
    const ports = { T_in: { x: 940, y: 155, tag: "TT" } };
    expect(layoutFor("paper", ["T_in"], {}, { canDraw: false, trayTop: 400, ports }).T_in).toEqual(ports.T_in);
    expect(layoutFor("paper", ["T_in"], { [PAPER + "T_in"]: { x: -1, y: -1, tag: "TT" } }, { canDraw: false, trayTop: 400, ports }).T_in.y).toBeGreaterThan(
      400,
    );
  });
  test("a new simulation variable takes its default spot and tag", () => {
    expect(spotForNewVar("Hour", [], {}, false, { canDraw: true, trayTop: 0 })).toEqual(DEFAULTS.Hour);
  });
});

describe("plant assignment", () => {
  const comps = [
    { id: "c1", label: "P1", x: 0.5, y: 0.5 },
    { id: "c2", label: "P2", x: 0.99, y: 0.001 },
  ];
  test("only plant: keys with a component are assignments", () => {
    expect(assignmentsFromLayout({ "plant:A": { x: 0, y: 0, tag: "c1" }, "plant:B": { x: -1, y: -1, tag: "" }, A: { x: 1, y: 1, tag: "TT" } })).toEqual({
      A: "c1",
    });
  });
  test("unassigned variables are written as {-1, -1, ''}", () => {
    expect(plantLayoutEntries(["A", "B"], comps, { A: "c1" })).toEqual({ "plant:A": { x: 0.5, y: 0.5, tag: "c1" }, "plant:B": { x: -1, y: -1, tag: "" } });
  });
});

test("save writes both diagrams; the one on screen wins over its stale stash", () => {
  const stash = { drawn: { A: { x: 1, y: 1, tag: "TT" } }, paper: { A: { x: 110, y: 50, tag: "TT" } } };
  const out = diagramsToSave("drawn", { A: { x: 9, y: 9, tag: "TT" } }, stash, 100);
  expect(out).toEqual({ A: { x: 9, y: 9, tag: "TT" }, "paper:A": { x: 0.1, y: 0.5, tag: "TT" } });
});

test("drawn defaults: room air above the upper rack row, load below the lower one, no Q instrument, no two bubbles touching", () => {
  const { In_Hum, In_Temp, IT_Load, ITE_Ener } = DEFAULTS;
  for (const p of [In_Hum, In_Temp]) expect(p.y + 22).toBeLessThan(270); // upper rack row starts at y 270
  for (const p of [IT_Load, ITE_Ener]) expect(p.y - 22).toBeGreaterThan(380); // lower rack row ends at y 380
  expect(Object.keys(DEFAULTS).filter((v) => v.endsWith("_Q"))).toEqual([]); // the HEX heat is calculated
  const spots = Object.values(DEFAULTS);
  for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * 22 + 20);
});

test("another structure's built-in drawing uses its own default spots, for its variables and for one added", () => {
  const defaults = { Q_dc: { x: 115, y: 90, tag: "QT" } };
  const frame = { canDraw: true, trayTop: 0, defaults };
  expect(layoutFor("drawn", ["Q_dc", "In_Temp"], {}, frame)).toEqual({ Q_dc: defaults.Q_dc, In_Temp: { x: 540, y: 595, tag: "TT" } });
  expect(spotForNewVar("Q_dc", [], {}, false, frame)).toEqual({ x: 115, y: 90, tag: "QT" });
});

test("with free cooling: the plate HEX's share has a spot, the rest as on the drawing without it", () => {
  expect(FC_DEFAULTS.FC_Share).toBeDefined();
  expect(FC_DEFAULTS.IT_Load).toEqual(DEFAULTS.IT_Load);
  expect(DEFAULTS.FC_Share).toBeUndefined();
});
