import { expect, test } from "vitest";
import { H, R, tapFor, W } from "../../datacenter/structure/geometry";
import { WEATHER_DEFAULTS, WEATHER_VARS } from "../../datacenter/structure/weatherBand";
import { DEFAULTS } from "../../datacenter/structure/layout";
import { weatherBox } from "../../datacenter/structure/connection";
import { DISTRICT_DEFAULTS, DISTRICT_LINKS, DISTRICT_NOTES, DISTRICT_STARTER, DISTRICT_TAPS } from "./districtLayout";
import { HEAT_STARTER } from "../../heat/structure/heatLayout";

test("the district's simple graph: the weather, the hour and the units drive the flow and the return; the demand is calculated from them", () => {
  expect(DISTRICT_STARTER).toEqual([
    "Q_houses",
    "T_dh_return",
    "T_dh_supply",
    "T_outdoor",
    "hour",
    "humidity",
    "m_dh",
    "n_units",
    "solar_radiation",
  ]);
  const into = (to: string) =>
    DISTRICT_LINKS.filter((l) => l.to === to)
      .map((l) => l.from)
      .sort();
  expect(into("Q_houses")).toEqual(["T_dh_return", "T_dh_supply", "m_dh"]); // Q = m · cp · (T_supply − T_return)
  expect(DISTRICT_LINKS.filter((l) => l.from === "Q_houses")).toEqual([]); // calculated: it causes nothing
  expect(DISTRICT_NOTES.Q_houses.kind).toBe("calculated");
  expect(into("m_dh")).toEqual([...WEATHER_VARS, "T_dh_supply", "m_dh", "n_units"].sort()); // what the buildings need; they store heat
  expect(into("T_dh_return")).toEqual(["T_dh_supply", "T_outdoor", "m_dh", "n_units"]);
  expect(into("T_dh_supply")).toEqual(["T_outdoor"]); // the heat distribution's heating curve
  for (const v of ["T_outdoor", "humidity", "solar_radiation"]) expect(DISTRICT_NOTES[v].kind).toBe("weather");
});

test("the same weather on every structure, and the district's water named as on the heat distribution's side", () => {
  for (const v of WEATHER_VARS) expect(HEAT_STARTER).toContain(v);
  // and in their boxes at the same slots as the data center's weather columns in its box (above the neighbour's box)
  const inBox = (scope: "dc" | "heat", n: number, p: { x: number; y: number }) => [p.x - weatherBox(scope, true, n)[0], p.y];
  expect([WEATHER_DEFAULTS.T_outdoor, WEATHER_DEFAULTS.humidity, WEATHER_DEFAULTS.solar_radiation].map((p) => inBox("heat", 4, p))).toEqual(
    [DEFAULTS.Out_Temp, DEFAULTS.Out_Hum, DEFAULTS.solar_radiation].map((p) => inBox("dc", 6, p)),
  );
  for (const v of ["T_dh_supply", "T_dh_return", "m_dh"]) expect(HEAT_STARTER).toContain(v);
});

test("its variables sit on the drawing, apart; the water taps onto its pipes, the weather onto nothing", () => {
  const spots = Object.values(DISTRICT_DEFAULTS);
  for (const s of spots) expect(s.x >= R && s.x <= W - R && s.y >= R && s.y <= H - R).toBe(true);
  for (const [i, a] of spots.entries()) for (const b of spots.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * R + 20);
  expect(tapFor("Q_houses", DISTRICT_DEFAULTS.Q_houses.x, DISTRICT_DEFAULTS.Q_houses.y, DISTRICT_TAPS)).toBeNull(); // the demand: on the supply itself, no tap
  expect(tapFor("T_dh_supply", 330, 150, DISTRICT_TAPS)?.[1]).toBe(198); // onto the supply, at the connection point's height
  expect(tapFor("m_dh", DISTRICT_DEFAULTS.m_dh.x, DISTRICT_DEFAULTS.m_dh.y, DISTRICT_TAPS)?.[1]).toBe(242); // the flow: on the return, below it
  expect(tapFor("T_outdoor", DISTRICT_DEFAULTS.T_outdoor.x, DISTRICT_DEFAULTS.T_outdoor.y, DISTRICT_TAPS)).toBeNull();
  expect(tapFor("n_units", DISTRICT_DEFAULTS.n_units.x, DISTRICT_DEFAULTS.n_units.y, DISTRICT_TAPS)).toBeNull(); // a number, no tap
});
