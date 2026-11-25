import { describe, expect, it } from "vitest";
import { parseDraft, parseView, type Draft, storeKey } from "./draft";

const draft: Draft = {
  at: 1,
  trayTop: 800,
  diagram: "paper",
  positions: { paper: { A: { x: 100, y: 200, tag: "TT" } } },
  vars: ["A", "B"],
  links: [{ from: "A", to: "B", lags: [1] }],
  strengths: [],
  assign: {},
  hex: "condenser",
};

describe("parseDraft", () => {
  it("reads back what was written", () => {
    expect(parseDraft(JSON.stringify(draft), 800)).toEqual(draft);
  });
  it("drops a draft made on another picture, a broken one and none", () => {
    expect(parseDraft(JSON.stringify(draft), 900)).toBeNull();
    expect(parseDraft("{not json", 800)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...draft, vars: "A" }), 800)).toBeNull();
    expect(parseDraft(null, 800)).toBeNull();
  });
  it("fills fields an older draft lacks", () => {
    const { strengths: _s, assign: _a, ...old } = draft;
    expect(parseDraft(JSON.stringify(old), 800)).toMatchObject({ strengths: [], assign: {} });
  });
});

describe("parseView", () => {
  it("reads view prefs, or null", () => {
    const v = { slider: 0.3, layers: { picture: false, construct: true, variables: true }, locked: true };
    expect(parseView(JSON.stringify(v))).toEqual(v);
    expect(parseView(JSON.stringify({ slider: "x" }))).toBeNull();
    expect(parseView(null)).toBeNull();
  });
});

it("another structure's browser key follows its starting layout; the data center's stays its id", () => {
  const a = storeKey("sim_x", "district", [["Q_houses"], [], { Q_houses: { x: 1, y: 2, tag: "QT" } }]);
  const b = storeKey("sim_x", "district", [["Q_houses"], [], { Q_houses: { x: 1, y: 3, tag: "QT" } }]);
  expect(a).toMatch(/^sim_x~district@[0-9a-z]+$/);
  expect(a).not.toBe(b); // a moved starting spot: the old draft is not brought back
  expect(storeKey("sim_x", "district", [["Q_houses"], [], { Q_houses: { x: 1, y: 2, tag: "QT" } }])).toBe(a);
  expect(storeKey("sim_x")).toBe("sim_x");
});
