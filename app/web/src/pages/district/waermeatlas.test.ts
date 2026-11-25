/** Wärmeatlas layer: view size, colour classes, tooltip escaping, a building as a heat sink. */
import { describe, expect, test } from "vitest";
import type { Site, WaermeatlasBuilding } from "../../api";
import { demandEntries, annualMwh } from "../../lib/demand";
import { areaDemand, areasAsBuildings, boxKm, HEAT_CLASSES, heatColor, insideRing, LINE_CLASSES, lineColor, ringBox, sinkUseColors, tiles, toSink, tooltipHtml, USE_CLASSES, classOfUse, colorOfUse, withBuildings } from "./waermeatlas";
import { profileFor } from "./siteEdits";

const building = (over: Partial<WaermeatlasBuilding> = {}): WaermeatlasBuilding => ({
  id: 7,
  lat: 50.11,
  lon: 8.67,
  use: "Bürogebäude",
  type: "Büro-, Verwaltungs- oder Amtsgebäude",
  age: "1958–1968",
  age_share: 0.62,
  area_m2: 5000,
  heating_kwh: 400000,
  hot_water_kwh: 100000,
  total_kwh: 500000,
  heating_2030_kwh: null,
  heating_2045_kwh: null,
  outline: [
    [50.11, 8.67],
    [50.111, 8.67],
    [50.111, 8.671],
    [50.11, 8.67],
  ],
  ...over,
});
const site: Site = { building: null, source: null, sinks: [] };

test("boxKm: ~1.1 km per 0.01° of latitude, less per degree of longitude in Frankfurt", () => {
  const { width, height } = boxKm([50.1, 8.6, 50.11, 8.62]);
  expect(height).toBeCloseTo(1.113, 2);
  expect(width).toBeCloseTo(1.427, 2);
});

test("heatColor: sequential classes by MWh/a, the last open-ended", () => {
  expect(heatColor(0)).toBe(HEAT_CLASSES[0].color);
  expect(heatColor(20000)).toBe(HEAT_CLASSES[0].color);
  expect(heatColor(20001)).toBe(HEAT_CLASSES[1].color);
  expect(heatColor(5e7)).toBe(HEAT_CLASSES.at(-1)!.color);
});

test("tooltip: data text is escaped", () => {
  const html = tooltipHtml(building({ use: "<img src=x onerror=alert(1)>" }));
  expect(html).not.toContain("<img");
  expect(html).toContain("&#60;img");
  expect(html).toContain("Heating 400,0 MWh/a · hot water 100,0 MWh/a");
});

describe("toSink", () => {
  test("one house with the building's demand and hot-water share; the demand model reads it back", () => {
    const sink = toSink(building(), 1);
    expect(sink).toMatchObject({ id: "wah-7", lat: 50.11, lon: 8.67, power_kw: 250, demand: { houses: 1, kwhPerHouse: 500000, dhwShare: 0.2 } });
    const [entry] = demandEntries({ ...site, sinks: [sink] });
    expect(annualMwh(entry.settings)).toBe(500);
    expect(entry.settings.dhwShare).toBe(0.2);
  });

  test("the correction factor applies to non-residential buildings only", () => {
    expect(toSink(building(), 1.8).demand?.kwhPerHouse).toBe(900000);
    expect(toSink(building({ type: "MFH" }), 1.8).demand?.kwhPerHouse).toBe(500000);
  });

  test("withBuildings never adds the same building twice", () => {
    const once = withBuildings(site, [building(), building({ id: 8 })], 1);
    expect(once.sinks.map((s) => s.id)).toEqual(["wah-7", "wah-8"]);
    expect(withBuildings(once, [building()], 1)).toBe(once);
  });
});

describe("the heat line density layer", () => {
  test("a large area is cut into tiles of at most 2 × 2 km that cover it; too many: none", () => {
    const box: [number, number, number, number] = [50.1, 8.6, 50.13, 8.66]; // ~4.3 × 3.3 km
    const t = tiles(box);
    expect(t).toHaveLength(6);
    for (const b of t) expect(Math.max(boxKm(b).width, boxKm(b).height)).toBeLessThanOrEqual(2);
    expect(Math.min(...t.map((b) => b[0]))).toBe(50.1);
    expect(Math.max(...t.map((b) => b[3]))).toBeCloseTo(8.66, 10);
    expect(tiles([50.11, 8.67, 50.111, 8.671])).toHaveLength(1);
    expect(tiles([49, 8, 51, 9])).toEqual([]);
  });

  test("the colour classes run light to dark with the density", () => {
    expect(lineColor(0.5)).toBe(LINE_CLASSES[0].color);
    expect(lineColor(1.5)).toBe(LINE_CLASSES[1].color);
    expect(lineColor(30)).toBe(LINE_CLASSES[LINE_CLASSES.length - 1].color);
  });
});

describe("a drawn district from the buildings inside it", () => {
  const ring: [number, number][] = [
    [50.1, 8.6],
    [50.1, 8.7],
    [50.2, 8.7],
    [50.2, 8.6],
  ];

  test("only the buildings whose centre lies inside count; their demand summed, one house each", () => {
    expect(insideRing(ring, 50.15, 8.65)).toBe(true);
    expect(insideRing(ring, 50.25, 8.65)).toBe(false);
    expect(ringBox(ring)).toEqual([50.1, 8.6, 50.2, 8.7]);
    const home = building({ id: 1, lat: 50.12, lon: 8.62, use: "Wohngebäude", type: "MFH", heating_kwh: 30000, hot_water_kwh: 10000 });
    const office = building({ id: 2, lat: 50.15, lon: 8.65 }); // 500 MWh, non-residential
    const outside = building({ id: 3, lat: 50.3, lon: 8.65 });
    const a = areaDemand(ring, [home, office, outside], 1.5)!;
    expect(a.buildings.map((b) => b.id)).toEqual([1, 2]);
    expect(a.mwh).toBeCloseTo(40 + 750, 6); // the office times the non-residential correction
    expect(a.demand.houses).toBe(2);
    expect(a.demand.houses * a.demand.kwhPerHouse).toBeCloseTo(790_000, -1);
    expect(a.demand.dhwShare).toBeCloseTo(110 / 540, 3);
    expect(a.demand.profile).toBe(profileFor(office.type, office.use)); // the office has the most demand
    const site: Site = { sinks: [{ id: "d", name: "District 1", lat: 50.15, lon: 8.65, temp_c: 70, power_kw: a.power_kw, outline: ring, area: true, demand: a.demand }] } as Site;
    expect(annualMwh(demandEntries(site)[0].settings)).toBeCloseTo(790, 0);
  });

  test("no building inside: none", () => {
    expect(areaDemand(ring, [building({ lat: 51, lon: 9 })])).toBeNull();
  });
});

test("classOfUse: homes, offices, commerce and industry, the rest; a colour each", () => {
  expect(classOfUse({ type: "MFH", use: "Wohngebäude" })).toBe("home");
  expect(classOfUse({ type: "RH", use: "Wohngebäude mit Handel und Dienstleistungen" })).toBe("home");
  expect(classOfUse({ type: "Büro-, Verwaltungs- oder Amtsgebäude", use: "Rathaus" })).toBe("office");
  expect(classOfUse({ type: "Handelsgebäude", use: "Laden" })).toBe("trade");
  expect(classOfUse({ type: "Verkehrsgebäude", use: "Tankstelle" })).toBe("trade");
  expect(classOfUse({ type: "Gebäude für Gewerbe und Industrie", use: null })).toBe("trade"); // none in Frankfurt's import yet
  expect(classOfUse({ type: "Schule, Kindertagesstätte und sonstige Betreuungsgebäude", use: "Schule" })).toBe("other");
  expect(classOfUse({ type: null, use: null })).toBe("other");
  expect(new Set(USE_CLASSES.map((c) => c.color)).size).toBe(USE_CLASSES.length);
  expect(colorOfUse({ type: "EFH", use: null })).toBe(USE_CLASSES[0].color);
});

test("sinkUseColors: a sink by its Wärmeatlas id or the building it stands on; none, a drawn area: no colour (temperature blue)", () => {
  const office = building();
  const home = building({ id: 9, type: "MFH", lat: 50.2, lon: 8.8, outline: null });
  const sink = (id: string, lat: number, lon: number, area = false) => ({ id, name: id, lat, lon, temp_c: 60, power_kw: 10, area });
  const fills = sinkUseColors(
    [office, home],
    [sink("wah-9", 0, 0), sink("osm-1", 50.1105, 8.6702), sink("osm-2", 50.2001, 8.8001), sink("osm-3", 51, 9), sink("area-1", 50.1105, 8.6702, true)],
  );
  expect(Object.fromEntries(fills)).toEqual({ "wah-9": USE_CLASSES[0].color, "osm-1": USE_CLASSES[1].color, "osm-2": USE_CLASSES[0].color });
});

test("a drawn district as its buildings: each a heat sink with its share of the area's demand, the rest kept", () => {
  const ring: [number, number][] = [
    [50.1, 8.6],
    [50.1, 8.7],
    [50.2, 8.7],
    [50.2, 8.6],
  ];
  const area = { id: "q", name: "Quarter", lat: 50.15, lon: 8.65, temp_c: 70, power_kw: 100, outline: ring, area: true, demand: { houses: 10, kwhPerHouse: 300_000 } };
  const lone = { id: "x", name: "One", lat: 50.3, lon: 8.9, temp_c: 70, power_kw: 5, demand: { houses: 1, kwhPerHouse: 20_000 } };
  const s: Site = { ...site, sinks: [area, lone] };
  const inside = [
    building({ id: 1, lat: 50.12, lon: 8.62, heating_kwh: 100_000, hot_water_kwh: 0, total_kwh: 100_000, use: "Wohngebäude", type: "MFH" }),
    building({ id: 2, lat: 50.18, lon: 8.68, heating_kwh: 300_000, hot_water_kwh: 0, total_kwh: 300_000, use: "Wohngebäude", type: "MFH" }),
  ];
  const out = building({ id: 3, lat: 50.5, lon: 8.65 }); // in the box, not inside the ring
  const kwh = (id: string) => (id === "q" ? 3_000_000 : null);
  const split = areasAsBuildings(s, new Map([["q", [...inside, out]]]), kwh);
  expect(split.sinks.map((x) => x.id)).toEqual(["q~1", "q~2", "x"]);
  const [a, b] = split.sinks;
  expect(a).toMatchObject({ area: false, lat: 50.12, lon: 8.62, outline: inside[0].outline, demand: { houses: 1, kwhPerHouse: 750_000 } });
  expect(b.demand).toMatchObject({ houses: 1, kwhPerHouse: 2_250_000 }); // 3 GWh by 1 : 3, the total kept
  const total = demandEntries(split).filter((e) => e.id.startsWith("q~")).reduce((t, e) => t + annualMwh(e.settings), 0);
  expect(total).toBeCloseTo(3000, 6);
  // not loaded, or no building inside: the area stays one heat sink
  expect(areasAsBuildings(s, new Map(), kwh)).toBe(s);
  expect(areasAsBuildings(s, new Map([["q", [out]]]), kwh)).toBe(s);
});
