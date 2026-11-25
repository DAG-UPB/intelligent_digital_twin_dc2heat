/** The heat network on tiny synthetic street grids: joins, routes, the Steiner tree, the buildings chosen (the data
 * center's share of the year, the heat pump's size), the pipes' loads, odd inputs. */
import { describe, expect, test } from "vitest";
import type { StreetWay } from "../../api";
import { planNetwork, simultaneity, streetBox, streetDensities, type NetworkBuilding, type NetworkInput } from "./network";
import type { Line } from "./osm";
import { distanceM } from "./siteEdits";

// metres east (x) and north (y) of 50° N, 8° E as [lat, lon] (the Earth's mean radius, as distanceM)
const M = 111_194.9;
const P = (x: number, y: number): [number, number] => [50 + y / M, 8 + x / (M * Math.cos((50 * Math.PI) / 180))];
const at = (x: number, y: number) => ({ lat: P(x, y)[0], lon: P(x, y)[1] });
const square = (x: number, y: number, r: number): [number, number][] => [P(x - r, y - r), P(x + r, y - r), P(x + r, y + r), P(x - r, y + r), P(x - r, y - r)];
const house = (id: string, x: number, y: number, peakKw = 10, annualMwh = 20): NetworkBuilding => ({
  id,
  ...at(x, y),
  outline: square(x, y, 5),
  peakKw,
  annualMwh,
});
const roads = (...lines: Line[]): StreetWay[] => lines.map((line) => ({ kind: "road", line }));
/** A year of `annualMwh` peaking in January: the mean × (1 + 0.8 cos), so the peak hour is 1.8 × the mean. */
const seasonal = (annualMwh: number) =>
  Float64Array.from({ length: 8760 }, (_, h) => ((annualMwh * 1000) / 8760) * (1 + 0.8 * Math.cos((2 * Math.PI * h) / 8760)));
/** A street grid: `n` × `n` crossings `step` m apart, from (0, 0). */
const grid = (n: number, step: number): StreetWay[] =>
  roads(
    ...Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => P(j * step, i * step))),
    ...Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => P(j * step, i * step))),
  );
const base = (over: Partial<NetworkInput>): NetworkInput => ({
  streets: roads([P(0, 0), P(300, 0)]),
  source: at(0, -10),
  buildings: [],
  capacityKw: 1e6,
  ...over,
});

test("simultaneity (Winter et al. 2001): 1 for one building, falling towards 0.45", () => {
  expect(simultaneity(1)).toBeCloseTo(1, 3);
  expect(simultaneity(150)).toBeCloseTo(0.527, 3);
  expect(simultaneity(10)).toBeGreaterThan(simultaneity(11));
  expect(simultaneity(1e6)).toBeCloseTo(0.4497, 4);
});

test("streetBox: the points' box plus the margin", () => {
  const [s, w, n, e] = streetBox([at(0, 0), at(100, 200)], 150);
  const [a, b] = [at(0, 0), at(100, 200)];
  expect([
    distanceM({ lat: s, lon: a.lon }, a),
    distanceM({ lat: a.lat, lon: w }, a),
    distanceM({ lat: n, lon: b.lon }, b),
    distanceM({ lat: b.lat, lon: e }, b),
  ]).toEqual(Array(4).fill(expect.closeTo(150, 0)));
});

test("a building joins the nearest street where it is nearest; its service pipe ends on its outline", () => {
  const net = planNetwork(base({ buildings: [house("a", 45, 20)], station: at(0, 0) }));
  const service = net.pipes.find((p) => p.kind === "service")!;
  expect(service.id).toBe("a");
  expect(service.line[0][1]).toBeCloseTo(P(45, 0)[1], 7); // on the street, under the house
  expect(service.line[1][0]).toBeCloseTo(P(45, 15)[0], 7); // the house's wall facing the street
  expect(service.m).toBeCloseTo(15, 1);
  const dist = net.pipes.filter((p) => p.kind === "distribution");
  expect(dist).toHaveLength(1);
  expect(dist[0].m).toBeCloseTo(45, 1);
  // the data center's own pipe to the street, 10 m, is the transmission line (the station is at its street point)
  expect(net.m).toEqual({ transmission: expect.closeTo(10, 1), distribution: expect.closeTo(45, 1), service: expect.closeTo(15, 1) });
  expect(net.density).toBeCloseTo(20 / 60, 3);
});

test("the pipes follow the streets round the block, and each run carries the buildings below it", () => {
  // a block 100 m a side; the station at its south-west corner, "far" north (10 m off the north street), "near" east
  const streets = roads([P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]);
  const buildings = [house("near", 110, 50), house("far", 60, 110, 30, 50)];
  const net = planNetwork({ streets, source: at(0, 0), buildings, capacityKw: 1e6, station: at(0, 0) });
  // "far" first (50 MWh for 160 + 5 m round the west), then "near", 90 m on from it: 250 m. Mehlhorn's tree is shorter,
  // 240 m: east to "near" (150 m) and on north to "far" (90 m)
  expect(net.chosen).toEqual(["far", "near"]);
  const dist = net.pipes.filter((p) => p.kind === "distribution");
  expect(dist.map((p) => [Math.round(p.m), p.buildings, p.annualMwh])).toEqual([
    [150, 2, 70],
    [90, 1, 50],
  ]);
  expect(dist[0].peakKw).toBeCloseTo(40 * simultaneity(2), 6);
  expect(dist[1].peakKw).toBeCloseTo(30 * simultaneity(1), 6);
  // every point of every run on one of the block's four streets
  const onStreet = ([la, lo]: [number, number]) =>
    Math.min(...[P(0, 0)[0], P(0, 100)[0]].map((v) => Math.abs(la - v)), ...[P(0, 0)[1], P(100, 0)[1]].map((v) => Math.abs(lo - v)));
  for (const p of dist) for (const pt of p.line) expect(onStreet(pt)).toBeLessThan(1e-9);
  expect(net.peakKw).toBeCloseTo(40 * simultaneity(2), 6);
  expect(net.annualMwh).toBe(70);
});

test("a road's sidewalks and crossings are left out: one pipe under the road, the house connections cross to both sides", () => {
  // OSM's way of mapping a street: the road, a sidewalk 6 m each side and a crossing; a house each side, its wall 10 m off
  const streets: StreetWay[] = [
    ...roads([P(0, 0), P(150, 0), P(300, 0)]),
    { kind: "sidewalk", line: [P(0, 6), P(150, 6), P(300, 6)] },
    { kind: "sidewalk", line: [P(0, -6), P(150, -6), P(300, -6)] },
    { kind: "crossing", line: [P(150, -6), P(150, 0), P(150, 6)] },
  ];
  const buildings = [house("north", 100, 15), house("south", 100, -15)];
  const net = planNetwork(base({ streets, buildings, station: at(0, 0) }));
  const dist = net.pipes.filter((p) => p.kind === "distribution");
  expect(dist).toHaveLength(1);
  for (const [la] of dist[0].line) expect(la).toBeCloseTo(P(0, 0)[0], 9); // under the road
  expect(dist[0].m).toBeCloseTo(100, 1);
  expect(net.pipes.filter((p) => p.kind === "service").map((p) => Math.round(p.m))).toEqual([10, 10]);
  // the sidewalks taken as streets: a pipe along each, over the crossing, beside the road's (262 m instead of 100)
  const doubled = planNetwork(base({ streets: streets.map((w) => ({ ...w, kind: "road" })), buildings, station: at(0, 0) }));
  expect(doubled.m.distribution).toBeCloseTo(262, 0);
});

test("sized for the full peak: the peak hour (with the pipes' losses) limits the buildings; the best demand per metre first", () => {
  // three houses peaking at 20.5 kW in the same January hour: 50 kW carry two of them and the losses, not three
  const buildings = [
    { ...house("far", 280, 10, 20.5, 100), kw: seasonal(100) },
    { ...house("near", 20, 10, 20.5, 100), kw: seasonal(100) },
    { ...house("mid", 150, 10, 20.5, 100), kw: seasonal(100) },
  ];
  const net = planNetwork(base({ buildings, capacityKw: 50, station: at(0, 0), fullPeak: true }));
  expect(net.chosen).toEqual(["near", "mid"]);
  expect(net.yearPeakKw).toBeLessThanOrEqual(50);
  expect(net.hpKw).toBeGreaterThan(net.yearPeakKw); // the whole peak hour and the losses, at most what the data center allows
  expect(net.hpKw).toBeLessThanOrEqual(50);
  // seasonal houses on one weather: their peak hour is above the design peak (the simultaneity on their peaks), and the
  // heat pump for the whole peak covers it, so no boiler
  const winter = Array.from({ length: 20 }, (_, i) => ({ ...house(`s${i}`, 10 + i * 12, 10, 1.8 * (100_000 / 8760), 100), kw: seasonal(100) }));
  const all = planNetwork(base({ buildings: winter, station: at(0, 0), fullPeak: true }));
  expect(all.yearPeakKw).toBeGreaterThan(all.peakKw);
  expect(all.hpKw).toBeGreaterThan(all.yearPeakKw); // and the pipes' losses on top
  expect(all.dcShare).toBeCloseTo(1, 6);
  expect(planNetwork(base({ buildings, station: at(0, 0), fullPeak: true })).chosen).toEqual(["near", "mid", "far"]);
  expect(planNetwork(base({ buildings, station: at(0, 0), maxBuildings: 1 })).chosen).toEqual(["near"]);
});

describe("the data center's share of the year (BEW's 75 %) chooses the buildings; the heat pump a share of the peak hour", () => {
  // ten houses of 100 MWh along the street (each 11.4 kW on average, 20.5 kW in January), a data center for 60 kW
  const buildings = Array.from({ length: 10 }, (_, i) => ({ ...house(`h${i}`, 20 + i * 25, 10, 20.5, 100), kw: seasonal(100) }));
  const plan = (over: Partial<NetworkInput>) => planNetwork(base({ buildings, capacityKw: 60, station: at(0, 0), ...over }));

  test("buildings join while the largest heat pump still gives the share: one more would not", () => {
    const net = plan({ hpShare: 1 }); // the heat pump as large as the data center allows: its share is the one checked
    expect(net.chosen.length).toBeGreaterThan(3);
    expect(net.chosen.length).toBeLessThan(10);
    expect(net.dcShare).toBeGreaterThanOrEqual(0.75);
    const more = plan({ hpShare: 1, minDcShare: 0, maxBuildings: net.chosen.length + 1 });
    expect(more.chosen).toEqual([...net.chosen, `h${net.chosen.length}`]);
    expect(more.dcShare).toBeLessThan(0.75);
    expect(plan({ minDcShare: 0 }).chosen).toHaveLength(10); // no share asked: all of them, the boiler does the rest
    expect(plan({ minDcShare: 0.5, hpShare: 1 }).chosen.length).toBeGreaterThan(net.chosen.length);
  });

  test("the heat pump: a share of the chosen buildings' peak hour, at most what the data center allows", () => {
    const net = plan({});
    const year = new Float64Array(8760);
    for (let i = 0; i < net.chosen.length; i++) seasonal(100).forEach((v, h) => (year[h] += v));
    expect(net.yearPeakKw).toBeCloseTo(Math.max(...year), 6); // no simultaneity on the hourly year
    expect(net.peakKw).toBeLessThan(net.yearPeakKw); // the pipes' design peak has it
    // half the peak hour gives this flat a load only ~68 % of its year: larger, just enough for the 75 %
    const half = plan({ minDcShare: 0 });
    expect(half.hpKw).toBeCloseTo(Math.min(60, 0.5 * half.yearPeakKw), 9);
    expect(half.dcShare).toBeLessThan(0.75);
    expect(net.hpKw).toBeGreaterThan(0.5 * net.yearPeakKw);
    expect(net.hpKw).toBeLessThanOrEqual(60);
    expect(net.dcShare).toBeCloseTo(0.75, 6);
    const big = plan({ hpShare: 0.9 });
    expect(big.hpKw).toBeCloseTo(Math.min(60, 0.9 * big.yearPeakKw), 9);
    // the full-peak rule: only what the design peak allows, the heat pump that big
    const full = plan({ fullPeak: true });
    expect(full.peakKw).toBeLessThanOrEqual(60);
    expect(full.hpKw).toBeGreaterThan(full.yearPeakKw); // the peak hour and the pipes' losses: above the design peak
    expect(full.hpKw).toBeLessThanOrEqual(60);
    expect(full.dcShare).toBeGreaterThan(0.99);
  });
});

test("a minimum heat density cuts a long branch to few buildings, keeps a dense one", () => {
  // a main street with two houses, and a 400 m side street to one small house
  const streets = roads([P(0, 0), P(100, 0)], [P(100, 0), P(100, 400)]);
  const buildings = [house("a", 30, 10, 10, 100), house("b", 60, 10, 10, 100), house("lonely", 110, 400, 10, 30)];
  const all = planNetwork(base({ streets, buildings, station: at(0, 0) }));
  expect(all.chosen).toEqual(["a", "b", "lonely"]);
  const dense = planNetwork(base({ streets, buildings, station: at(0, 0), minDensity: 0.5 }));
  expect(dense.chosen).toEqual(["a", "b"]);
  expect(dense.m.distribution).toBeCloseTo(60, 0);
});

test("the station: moved onto the street; the transmission line crosses the grounds straight, then follows the streets", () => {
  // the station 226 m away, beyond the grounds (150 m): straight to the street corner (100, 100), then along the streets
  const net = planNetwork({ streets: grid(3, 100), source: at(0, -10), buildings: [house("x", 210, 200)], capacityKw: 1e6, station: at(205, 95) });
  expect(net.station!.lat).toBeCloseTo(P(200, 95)[0], 7);
  const t = net.pipes.find((p) => p.kind === "transmission")!;
  expect(t.line[0]).toEqual(P(0, -10));
  expect(t.line[1][0]).toBeCloseTo(P(100, 100)[0], 7);
  expect(t.line[t.line.length - 1][0]).toBeCloseTo(P(200, 95)[0], 7);
  expect(t.m).toBeCloseTo(Math.hypot(100, 110) + 105, 0);
  expect(t.buildings).toBe(1);
  expect(t.served).toEqual([0]);
  expect(net.m.distribution).toBeCloseTo(105, 0);
  // a station within the grounds' reach: one straight line
  const near = planNetwork({ streets: grid(3, 100), source: at(0, -10), buildings: [house("x", 210, 200)], capacityKw: 1e6, station: at(0, 95) });
  const n = near.pipes.find((p) => p.kind === "transmission")!;
  expect(n.line).toHaveLength(2);
  expect(n.m).toBeCloseTo(105, 0);
  // from the data center's outline (its wall nearest the street point it crosses to), not its centre
  const walled = planNetwork({
    streets: grid(3, 100),
    source: { ...at(0, -10), outline: square(0, -10, 8) },
    buildings: [house("x", 210, 200)],
    capacityKw: 1e6,
    station: at(205, 95),
  });
  const w = walled.pipes.find((p) => p.kind === "transmission")!;
  expect(w.line[0][0]).toBeCloseTo(P(8, -2)[0], 7); // the corner towards the street point
  expect(w.m).toBeCloseTo(Math.hypot(92, 102) + 105, 0);
});

test("without a station given, it is placed on the way from the data center towards the load", () => {
  const buildings = Array.from({ length: 6 }, (_, i) => house(`h${i}`, 210 + (i % 2) * 80, 110 + Math.floor(i / 2) * 60));
  const net = planNetwork({ streets: grid(5, 100), source: at(0, -10), buildings, capacityKw: 1e6 });
  expect(net.chosen).toHaveLength(6);
  const t = net.pipes.find((p) => p.kind === "transmission")!;
  expect(t.line[0]).toEqual(P(0, -10)); // from the data center ...
  expect(t.line[t.line.length - 1]).toEqual([net.station!.lat, net.station!.lon]); // ... to the station
  expect(net.totalM).toBeCloseTo(net.m.transmission + net.m.distribution + net.m.service, 6);
  expect(planNetwork({ streets: grid(5, 100), source: at(0, -10), buildings, capacityKw: 1e6 })).toEqual(net); // deterministic
});

describe("routing", () => {
  test("the Steiner tree: Mehlhorn's beats joining in the order chosen when that order takes the long way", () => {
    // a block 100 m a side, the station at its south-west corner; "big" first (500 MWh, near the north-east corner on the
    // east street: 190 m round the south), then "small" on the north street joins the tree at the north-east (100 m):
    // 290 m. Up the west street and along the north one serves both in 210 m
    const streets = roads([P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]);
    const buildings = [house("big", 110, 90, 100, 500), house("small", 10, 110, 10, 20)];
    const net = planNetwork(base({ streets, buildings, station: at(0, 0) }));
    expect(net.chosen).toEqual(["big", "small"]);
    expect(net.m.distribution).toBeCloseTo(210, 0);
    const runs = net.pipes.filter((p) => p.kind === "distribution");
    expect(runs.map((p) => [Math.round(p.m), p.served])).toEqual([
      [110, [0, 1]], // the station up to "small": both downstream
      [100, [0]], // on to "big"
    ]);
  });

  test("no building is fed the long way round a block: its way at most 1.5 times its shortest along the streets (+ 50 m)", () => {
    // a block 100 m a side, the station at its south-west corner, houses all round it but on the south street's first
    // 70 m: the shortest trench (330 m) cuts the block there and feeds "s70", 70 m east of the station, round the other
    // three sides (330 m)
    const streets = roads([P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)]);
    const round = { s: (v: number) => v, e: (v: number) => 100 + v, n: (v: number) => 300 - v, w: (v: number) => 400 - v }; // m round the block
    const xy = { s: (v: number) => [v, -10], e: (v: number) => [110, v], n: (v: number) => [v, 110], w: (v: number) => [-10, v] };
    const spots: [keyof typeof round, number][] = [
      ["s", 70],
      ["s", 90],
      ...(["e", "n", "w"] as const).flatMap((k) => [20, 40, 60, 80].map((v): [typeof k, number] => [k, v])),
    ];
    const buildings = spots.map(([k, v]) => house(`${k}${v}`, xy[k](v)[0], xy[k](v)[1]));
    const net = planNetwork(base({ streets, buildings, station: at(0, 0) }));
    expect(net.chosen).toHaveLength(spots.length);
    const runs = net.pipes.filter((p) => p.kind === "distribution");
    net.chosen.forEach((id, i) => {
      const [k, v] = spots.find(([kk, vv]) => `${kk}${vv}` === id)!;
      const way = runs.filter((p) => p.served.includes(i)).reduce((a, p) => a + p.m, 0);
      const shortest = Math.min(round[k](v), 400 - round[k](v));
      expect(way).toBeLessThanOrEqual(1.5 * shortest + 50 + 1e-6);
      if (id === "s70") expect(way).toBeCloseTo(70, 3); // straight along the south street
    });
    expect(net.m.distribution).toBeGreaterThan(330); // a little more trench than the shortest tree
    expect(net.m.distribution).toBeLessThan(400); // still a tree, the block cut once
  });

  test("a service pipe does not cross another building: the next street point instead", () => {
    // "back" stands behind "front"; straight down to the street its pipe would run through "front"
    const streets = roads([P(0, 0), P(100, 0), P(300, 0)]);
    const front = house("front", 50, 15);
    const back = house("back", 50, 40);
    const net = planNetwork(base({ streets, buildings: [front, back], station: at(0, 0) }));
    const pipe = net.pipes.find((p) => p.id === "back")!;
    expect(pipe.line[0][1]).toBeCloseTo(P(100, 0)[1], 9); // the next segment's nearest point, the corner at 100 m
    expect(pipe.line[1][0]).toBeCloseTo(P(55, 35)[0], 7); // the corner of "back" facing it
    expect(pipe.m).toBeCloseTo(Math.hypot(45, 35), 0);
    const alone = planNetwork(base({ streets, buildings: [back], station: at(0, 0) }));
    expect(alone.pipes.find((p) => p.id === "back")!.m).toBeCloseTo(35, 1); // with nothing in the way: straight down
  });

  test("a building joins the street nearest its outline, not its centre", () => {
    // a long building whose centre is nearer the north street (y 60) but whose south wall is 4 m off the south one (y 0)
    const outline: [number, number][] = [P(0, 4), P(100, 4), P(100, 50), P(0, 50), P(0, 4)];
    const long = { id: "long", ...at(50, 34), outline, peakKw: 10, annualMwh: 20 };
    const streets = roads([P(-10, 0), P(110, 0)], [P(-10, 0), P(-10, 60), P(110, 60)]);
    const net = planNetwork(base({ streets, buildings: [long], station: at(-10, 0) }));
    const pipe = net.pipes.find((p) => p.id === "long")!;
    expect(pipe.line[0][0]).toBeCloseTo(P(0, 0)[0], 9);
    expect(pipe.m).toBeCloseTo(4, 1);
  });

  test("each pipe lists the buildings downstream; the tree's runs add up and every point joined is on the streets", () => {
    const buildings = Array.from({ length: 6 }, (_, i) => house(`h${i}`, 110 + (i % 3) * 90, 15 + Math.floor(i / 3) * 100));
    const net = planNetwork({ streets: grid(4, 100), source: at(0, -10), buildings, capacityKw: 1e6, station: at(0, 0) });
    expect(net.chosen).toHaveLength(6);
    const t = net.pipes.find((p) => p.kind === "transmission")!;
    expect(t.served).toEqual([0, 1, 2, 3, 4, 5]);
    for (const p of net.pipes) {
      expect(p.served).toHaveLength(p.buildings);
      expect(p.annualMwh).toBeCloseTo(p.served.length * 20, 9);
    }
    const service = net.pipes.filter((p) => p.kind === "service");
    expect(service.map((p) => p.served[0])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(service.map((p) => p.id)).toEqual(net.chosen);
  });

  test("ties are broken the same way every time: a symmetric grid gives one plan, again and again", () => {
    const buildings = [house("e", 210, 10), house("n", 10, 210), house("ne", 210, 210)];
    const input = { streets: grid(3, 200), source: at(-10, -10), buildings, capacityKw: 1e6, station: at(0, 0) };
    const net = planNetwork(input);
    for (let i = 0; i < 3; i++) expect(planNetwork(input)).toEqual(net);
  });
});

describe("odd inputs", () => {
  test("no streets: no network, every building unreached", () => {
    const net = planNetwork(base({ streets: [], buildings: [house("a", 10, 10)] }));
    expect(net.problem).toMatch(/No streets/);
    expect(net.unreached).toEqual([{ id: "a", reason: "No streets around the site" }]);
  });

  test("a building far from every street, or on streets not joined to the network's, is unreached", () => {
    const streets = roads([P(0, 0), P(100, 0)], [P(0, 500), P(100, 500)]);
    const net = planNetwork(base({ streets, buildings: [house("ok", 50, 10), house("far", 50, 200), house("island", 50, 510)] }));
    expect(net.chosen).toEqual(["ok"]);
    expect(net.unreached).toEqual([
      { id: "far", reason: "195 m from the nearest street" },
      { id: "island", reason: "its street is not connected to the network's" },
    ]);
    // a station put on the other street moves onto the network's
    const moved = planNetwork(base({ streets, buildings: [house("ok", 50, 10)], station: at(50, 505) }));
    expect(moved.problem).toBeNull();
    expect(moved.station!.lat).toBeCloseTo(P(50, 0)[0], 7);
  });

  test("the network takes the streets most of the demand is near, though the data center is beside another", () => {
    // the data center by a short path of its own; three houses along a road 300 m north, not joined to it
    const streets = roads([P(-20, 0), P(20, 0)], [P(0, 300), P(300, 300)]);
    const buildings = [house("a", 50, 310), house("b", 150, 310), house("c", 250, 310)];
    const net = planNetwork(base({ streets, buildings }));
    expect(net.chosen).toHaveLength(3);
    expect(net.unreached).toEqual([]);
    expect(net.station!.lat).toBeCloseTo(P(0, 300)[0], 7); // on the road
    const t = net.pipes.find((p) => p.kind === "transmission")!;
    expect(t.m).toBeCloseTo(distanceM(at(0, -10), net.station!), 6); // straight across from the data center
  });

  test("two buildings at the same spot, repeated street points and a way drawn twice", () => {
    const streets = roads([P(0, 0), P(0, 0), P(100, 0)], [P(100, 0), P(0, 0)]);
    const net = planNetwork(base({ streets, buildings: [house("a", 50, 10), house("b", 50, 10)], station: at(0, 0) }));
    expect(net.chosen).toEqual(["a", "b"]);
    expect(net.m.distribution).toBeCloseTo(50, 1);
    expect(net.pipes.filter((p) => p.kind === "distribution")).toHaveLength(1);
  });

  test("no building with demand: a station, no pipes", () => {
    const net = planNetwork(base({ buildings: [house("cold", 50, 10, 0, 0)] }));
    expect([net.chosen, net.pipes, net.problem]).toEqual([[], [], null]);
  });
});

test("fast: 150 buildings with their hourly years on a 40 × 40 grid (1,600 crossings, 3,120 street segments) in well under a second", () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const buildings = Array.from({ length: 150 }, (_, i) => {
    const mwh = 40 + rnd() * 400;
    return { ...house(`h${i}`, 600 + rnd() * 1200, 600 + rnd() * 1200 + 15, (1.8 * mwh * 1000) / 8760, mwh), kw: seasonal(mwh) };
  });
  const input = { streets: grid(40, 60), source: at(500, 490), buildings, capacityKw: 3000, minDensity: 0.5 };
  planNetwork(input); // warm up
  const t0 = performance.now();
  const net = planNetwork(input);
  const ms = performance.now() - t0; // ~70 ms on a laptop, as the example (2,700 segments, 150 buildings)
  expect(net.chosen.length).toBeGreaterThan(10);
  expect(net.chosen.length).toBeLessThan(150); // the data center's share stops it
  expect(net.dcShare).toBeGreaterThanOrEqual(0.75);
  expect(net.hpKw).toBeLessThanOrEqual(3000);
  expect(ms).toBeLessThan(600); // ~100 ms alone; a loaded machine (the whole suite in parallel) takes a few times that
});

test("a footpath beside the road: the houses join the road, the main runs once under it", () => {
  // a road along y = 0 and a footpath along y = 12 beside it, joined at both ends; houses north of the footpath
  const streets: StreetWay[] = [...roads([P(0, 0), P(300, 0)]), { kind: "path", line: [P(0, 0), P(0, 12), P(300, 12), P(300, 0)] }];
  const buildings = [house("a", 80, 30), house("b", 160, 30), house("c", 240, 30)];
  const net = planNetwork(base({ streets, buildings, station: at(0, 0) }));
  expect(net.chosen).toHaveLength(3);
  expect(net.m.distribution).toBeCloseTo(240, 0); // along the road to the last house's point, not the footpath too
  for (const p of net.pipes.filter((x) => x.kind === "distribution")) for (const [la] of p.line) expect(la).toBeCloseTo(P(0, 0)[0], 6);
});

test("along a footpath the pipes count their own metres: the 1.3 only steers the way (the line and the reach)", () => {
  // the data center 10 m from a 1,000 m footpath, the station at its far end; a house at 450 m, one at 600 m
  const streets: StreetWay[] = [{ kind: "path", line: [P(0, 0), P(1000, 0)] }];
  const net = planNetwork(base({ streets, buildings: [house("a", 450, 10)], station: at(1000, 0) }));
  expect(net.m.transmission).toBeCloseTo(1010, 0); // was 1,310: the footpath's weight as metres
  const reach = planNetwork(base({ streets, buildings: [house("in", 450, 10), house("out", 600, 10)], station: at(0, 0), reachM: 500 }));
  expect(reach.chosen).toEqual(["in"]); // 450 m away: within 500 m (weighted, 585 m, it was left out)
  expect(reach.unreached.find((u) => u.id === "out")?.reason).toMatch(/^600 m along the streets/);
});

test("the station's reach: a building further along the streets is left out, with why", () => {
  const streets = roads([P(0, 0), P(900, 0)]);
  const buildings = [house("near", 100, 10), house("far", 800, 10, 200, 2000)];
  const net = planNetwork(base({ streets, buildings, station: at(0, 0), reachM: 500 }));
  expect(net.chosen).toEqual(["near"]);
  expect(net.unreached.find((u) => u.id === "far")?.reason).toMatch(/along the streets from the station, beyond its reach of 500 m/);
});

describe("the heat line density (Wärmeatlas): the pipes prefer the dense streets", () => {
  // two ways from the station at (0, 0) to a house past the corner at (200, 100): east then north, 300 m; north, east
  // along y = 110, then down, 320 m. The longer one's streets carry the heat
  const east = [P(0, 0), P(200, 0), P(200, 100)];
  const north = [P(0, 0), P(0, 110), P(200, 110), P(200, 100)];
  const dense = [
    { line: [[P(0, 2), P(0, 108)]], mwhPerM: 6 },
    { line: [[P(2, 112), P(198, 112)]], mwhPerM: 6 }, // 2 m off the street, as LEA's axes and OSM's differ
  ];
  const input = base({ streets: roads(east, north), buildings: [house("a", 215, 100)], station: at(0, 0) });
  const onNorth = (net: ReturnType<typeof planNetwork>) =>
    net.pipes.some((p) => p.kind === "distribution" && p.line.some(([la]) => Math.abs(la - P(0, 110)[0]) < 1e-7));

  test("without heat lines the shortest way, as before, and no street density", () => {
    const net = planNetwork(input);
    expect(onNorth(net)).toBe(false);
    expect(net.m.distribution).toBeCloseTo(300, 0);
    expect(net.streetDensity).toBeNull();
  });

  test("with them the way along the dense streets; its metres are the real ones", () => {
    const net = planNetwork({ ...input, heatLines: dense });
    expect(onNorth(net)).toBe(true);
    expect(net.m.distribution).toBeCloseTo(320, 0);
    expect(net.streetDensity).toBeCloseTo((6 * 310) / 320, 1); // the last 10 m down to the corner carry none
    expect(planNetwork({ ...input, heatLines: dense, densityPull: 0 }).m.distribution).toBeCloseTo(300, 0); // pull 0: as before
  });

  test("a street matches only the Wärmeatlas segment beside it and along it, not a cross street", () => {
    const toXy = (la: number, lo: number): [number, number] => [(lo - 8) * M * Math.cos((50 * Math.PI) / 180), (la - 50) * M];
    const lines = [{ line: [[P(0, 15), P(100, 15)]], mwhPerM: 3 }, { line: [[P(50, -100), P(50, 100)]], mwhPerM: 9 }];
    const d = streetDensities(
      [
        [0, 0, 100, 0], // 15 m beside the first, parallel: 3
        [0, 40, 100, 40], // 25 m off: none
        [45, 0, 55, 0], // a short piece across the cross street: parallel to the first, 15 m off; the cross street is across
        [50, -20, 50, -10], // along the cross street: 9
      ],
      lines,
      toXy,
    );
    expect([...d]).toEqual([3, 0, 3, 9]);
  });
});

// K4: while buildings were chosen, a footpath's metre counted 1.3 (its routing weight) in the pipes' losses
test("choosing buildings along a footpath counts its own metres: a building a road would supply is supplied by a path too", () => {
  // one flat 100 kW building 1,000 m along the street; the data center allows 126 kW and must give all of the year:
  // 100 kW + 25 W/m × (1,000 m + its 5 m house connection) = 125.1 kW fits; with the path's metres × 1.3 it "needed" 132.6
  const flat = { ...house("a", 1000, 10, 100, 876), kw: new Float64Array(8760).fill(100) };
  const plan = (kind: StreetWay["kind"]) =>
    planNetwork(base({ streets: [{ kind, line: [P(0, 0), P(1000, 0)] }], buildings: [flat], station: at(0, 0), capacityKw: 126, minDcShare: 1 }));
  expect(plan("road").chosen).toEqual(["a"]);
  expect(plan("path").chosen).toEqual(["a"]); // was refused
  expect(plan("path").m.distribution).toBeCloseTo(plan("road").m.distribution, 6);
});

test("the long way round is measured in metres on footpaths too: the 1.5 times is not 1.95 times", () => {
  // a house 400 m up a footpath from the station; the tree reaches it by 700 m of road past a big building. The limit
  // is 1.5 × 400 m + 50 m = 650 m: it is fed by the path instead (with the path's weighted 520 m the limit was 830 m)
  const streets: StreetWay[] = [{ kind: "path", line: [P(0, 0), P(0, 400)] }, ...roads([P(0, 0), P(150, 0), P(150, 400), P(0, 400)])];
  const net = planNetwork(base({ streets, buildings: [house("up", 0, 410), house("side", 160, 200, 100, 2000)], station: at(0, 0) }));
  expect(net.chosen).toContain("up");
  const up = net.pipes.filter((p) => p.kind === "distribution" && p.served.includes(net.chosen.indexOf("up")));
  expect(up.reduce((a, p) => a + p.m, 0)).toBeLessThanOrEqual(650); // was 700
});

// K18: a data center far from every street got one straight line of any length, costed without a word
test("a data center with no street within its grounds' reach: the straight line is planned, and said", () => {
  const streets = roads([P(0, 1000), P(300, 1000)]);
  const far = planNetwork(base({ streets, buildings: [house("a", 50, 1010), house("b", 150, 1010)] }));
  expect(far.m.transmission).toBeGreaterThan(1000);
  expect(far.warning).toMatch(/^The transmission line runs 1\.0\d\d m in a straight line: no street is within 150 m of the data center/);
  expect(planNetwork(base({ buildings: [house("a", 50, 10)] })).warning).toBeNull(); // 10 m from its street
  expect(planNetwork(base({ streets: [], buildings: [house("a", 10, 10)] })).warning).toBeNull(); // no network: its problem says why
});
