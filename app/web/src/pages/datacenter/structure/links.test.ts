/** Links <-> graph file, link edits and merging discovered lags. */
import { describe, expect, test } from "vitest";
import type { LagDiscoveryResult } from "../../../api";
import {
  allPairs,
  applyDiscoveredLags,
  blindDiscovered,
  withDataColumns,
  linkWidths,
  discoverySummary,
  graphNameError,
  linksFromTargets,
  noEvidenceOf,
  parseLags,
  selfLagsOf,
  toSavePayload,
  withDiscoveredStrengths,
  withLink,
  withLinkLags,
  withSelfLags,
  type Link,
  mergedInto,
} from "./links";

test.each([
  ["1, 3;3 -2", [1, 2, 3]],
  ["0", [0]],
  ["x", []],
  ["", []],
])("parseLags(%j)", (s, lags) => expect(parseLags(s)).toEqual(lags));

describe("graph file", () => {
  const targets = { B: [{ parent: "A", lag: -1 }, { parent: "A", lag: -3 }], A: [{ parent: "A", lag: -2 }], C: [] };
  const { vars, links } = linksFromTargets(targets);

  test("vars are targets and parents, sorted; lags positive, one link per pair", () => {
    expect(vars).toEqual(["A", "B", "C"]);
    expect(links).toEqual([
      { from: "A", to: "B", lags: [1, 3] },
      { from: "A", to: "A", lags: [2] },
    ]);
  });

  test("save payload round-trips and keeps only the strengths of drawn lags", () => {
    const strengths = [
      { source: "A", target: "B", lag: -1, value: 0.5 },
      { source: "A", target: "B", lag: -2, value: 0.1 },
    ];
    const p = toSavePayload(vars, links, strengths);
    expect(p.targets.C).toEqual([]);
    const back = linksFromTargets(p.targets);
    expect(back.vars).toEqual(vars);
    expect(back.links).toEqual(expect.arrayContaining(links));
    expect(back.links).toHaveLength(links.length);
    expect(p.link_strengths).toEqual([strengths[0]]);
  });
});

describe("edits", () => {
  const ls: Link[] = [
    { from: "A", to: "B", lags: [1] },
    { from: "A", to: "A", lags: [2] },
  ];
  test("a duplicate link is ignored, a new one gets lag 1", () => {
    expect(withLink(ls, "A", "B")).toBe(ls);
    expect(withLink(ls, "B", "B").at(-1)).toEqual({ from: "B", to: "B", lags: [1] });
  });
  test("link lags: set, or delete with none", () => {
    expect(withLinkLags(ls, "A->B", [0, 4])[0].lags).toEqual([0, 4]);
    expect(withLinkLags(ls, "A->B", [])).toEqual([ls[1]]);
  });
  test("self lags drop 0; none removes the self-link", () => {
    expect(selfLagsOf(withSelfLags(ls, "A", [0, 3]))).toEqual({ A: [3] });
    expect(selfLagsOf(withSelfLags(ls, "A", [0]))).toEqual({});
  });
});

describe("discovered lags", () => {
  const ls: Link[] = [
    { from: "A", to: "B", lags: [0, 1] },
    { from: "B", to: "C", lags: [1] },
    { from: "C", to: "D", lags: [0] },
    { from: "A", to: "A", lags: [1] },
    { from: "C", to: "C", lags: [5] },
  ];
  const res: LagDiscoveryResult = {
    links: [
      { source: "A", target: "B", lags: [2], p: {} },
      { source: "B", target: "C", lags: [], p: {} },
      { source: "C", target: "D", lags: [], p: {} },
    ],
    self: { A: [3], B: [1] },
    skipped: [],
  };
  const out = applyDiscoveredLags(ls, res);

  test("found lags replace the old ones, keeping 0", () => expect(out[0].lags).toEqual([0, 2]));
  test("a link with none found is kept unchanged", () => expect(out[1]).toEqual(ls[1]));
  test("self lags only where there was a self-link; others kept", () => {
    expect(selfLagsOf(out)).toEqual({ A: [3], C: [5] });
  });
  test("no evidence: none found and not same-hour", () => {
    expect([...noEvidenceOf(ls, res)]).toEqual(["B->C"]);
  });
  test("discovered strengths replace those of the same lag; others stay; old servers send none", () => {
    const old = [
      { source: "A", target: "B", lag: -1, value: 0.1 },
      { source: "A", target: "B", lag: -2, value: 0.2 },
    ];
    const fresh = { source: "A", target: "B", lag: -2, value: 0.9 };
    expect(withDiscoveredStrengths(old, { ...res, link_strengths: [fresh] })).toEqual([old[0], fresh]);
    expect(withDiscoveredStrengths(old, res)).toEqual(old);
    // after a save only the drawn lags keep theirs: the discovered link is A->B lags [0, 2]
    expect(toSavePayload(["A", "B"], [out[0]], withDiscoveredStrengths(old, { ...res, link_strengths: [fresh] })).link_strengths).toEqual([fresh]);
  });
  test("blind discovery: all pairs tested; links among them replaced by the found ones, others kept", () => {
    expect(allPairs(["A", "B", "C"])).toHaveLength(6);
    expect(blindDiscovered([...ls, { from: "X", to: "A", lags: [1] }], ["A", "B", "C", "D"], res)).toEqual([
      { from: "X", to: "A", lags: [1] },
      { from: "A", to: "B", lags: [2] },
      { from: "A", to: "A", lags: [3] },
      { from: "B", to: "B", lags: [1] },
    ]);
  });
  test("summary counts", () => {
    expect(discoverySummary({ ...res, skipped: [{ source: "X", target: "Y" }] }, 1)).toBe(
      "Lags updated for 2 links. 1 links show no significant lag (red, kept: delete them if you agree). 1 skipped: variables not in the data. Save to keep.",
    );
  });
});

test.each([
  ["causal_graph_lags.json", null],
  ["  mine.JSON ", null],
  ["mine", "Must end with .json."],
  [".json", "Must end with .json."],
  ["a.canvas.json", "Must end with .json."],
  ["../x.json", "A file name, not a path."],
  ["site.json", "site.json is not a graph file: pick another name."],
])("graphNameError(%j)", (name, err) => expect(graphNameError(name)).toBe(err));

test("every data column is drawn, linked or not; time is not a variable", () => {
  expect(withDataColumns(["B", "A"], ["time", "C", "A"])).toEqual(["A", "B", "C"]);
});

test("link width follows the strongest |partial correlation| of its lags, in a narrow range", () => {
  const w = linkWidths([
    { source: "A", target: "B", lag: -1, value: 0.2 },
    { source: "A", target: "B", lag: -2, value: -0.9 },
    { source: "C", target: "B", lag: -1, value: 0 },
  ]);
  expect(w("A->B")).toBeCloseTo(0.8 + 1.2 * 0.9);
  expect(w("C->B")).toBe(0.8); // weakest, still visible
  expect(w("X->Y")).toBe(1.2); // no strength known: the middle
});

test("mergedInto: the variable made the same as another passes it its links, lags joined", () => {
  const links = [
    { from: "IT_load", to: "IT_power", lags: [1] },
    { from: "my_load", to: "IT_power", lags: [2] },
    { from: "my_load", to: "IT_load", lags: [1] },
    { from: "T", to: "IT_load", lags: [3] },
  ];
  expect(mergedInto(links, "IT_load", "my_load")).toEqual([
    { from: "my_load", to: "IT_power", lags: [1, 2] },
    { from: "T", to: "my_load", lags: [3] },
  ]);
});
