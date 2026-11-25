/** OSM helpers: polygon geometry, and buildingAt's three lookups with a stubbed fetch. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildingAt, centroid, contains, outerRing, pickForest, searchAddress, streetKind, streetsIn, type Ring } from "./osm";

const square: Ring = [
  [0, 0],
  [0, 2],
  [2, 2],
  [2, 0],
  [0, 0],
];
// a "U": the notch between x 1..2, y 1..3 is outside
const concave: Ring = [
  [0, 0],
  [0, 3],
  [3, 3],
  [3, 2],
  [1, 2],
  [1, 1],
  [3, 1],
  [3, 0],
  [0, 0],
];

describe("contains", () => {
  test("square", () => {
    expect(contains(square, 1, 1)).toBe(true);
    expect(contains(square, 3, 1)).toBe(false);
  });
  test("concave polygon", () => {
    expect(contains(concave, 0.5, 0.5)).toBe(true);
    expect(contains(concave, 2, 1.5)).toBe(false); // in the notch
    expect(contains(concave, 2, 2.5)).toBe(true);
  });
});

test("centroid leaves out the closing point", () => {
  expect(centroid(square)).toEqual([1, 1]);
});

test("outerRing swaps GeoJSON [lon, lat] to [lat, lon]", () => {
  expect(outerRing({ type: "Polygon", coordinates: [[[8, 50], [9, 51]]] })).toEqual([[50, 8], [51, 9]]);
  expect(outerRing({ type: "MultiPolygon", coordinates: [[[[8, 50]]]] })).toEqual([[50, 8]]);
  expect(outerRing({ type: "Point", coordinates: [8, 50] })).toBeNull();
  expect(outerRing(undefined)).toBeNull();
});

/** fetch stub answering by URL prefix. */
function stubFetch(answers: [string, unknown][]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const hit = answers.find(([prefix]) => url.startsWith(prefix));
    return { ok: !!hit, json: async () => hit?.[1] };
  });
  return calls;
}
const poly = { type: "Polygon", coordinates: [[[8, 50], [8, 51], [9, 51], [9, 50], [8, 50]]] };

describe("buildingAt", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("a click on a building: the reverse lookup's polygon", async () => {
    stubFetch([["https://nominatim.openstreetmap.org/reverse", { category: "building", osm_id: 7, name: "", address: { road: "Main", house_number: "1" }, geojson: poly }]]);
    const b = await buildingAt(50.5, 8.5);
    expect(b?.name).toBe("Main 1");
    expect(b?.id).toBe(7);
    expect(b?.ring[0]).toEqual([50, 8]);
  });

  test("a street: no building and no further lookups", async () => {
    const calls = stubFetch([["https://nominatim.openstreetmap.org/reverse", { category: "highway", geojson: { type: "LineString" } }]]);
    expect(await buildingAt(50.5, 8.5)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a point inside a building: the street search hit that contains the click", async () => {
    stubFetch([
      ["https://nominatim.openstreetmap.org/reverse", { category: "shop", geojson: { type: "Point" }, address: { road: "Main", house_number: "1" } }],
      ["https://nominatim.openstreetmap.org/search", [{ category: "building", osm_id: 9, name: "Tower", geojson: poly }]],
    ]);
    expect((await buildingAt(50.5, 8.5))?.name).toBe("Tower");
  });

  test("Overpass is the last resort", async () => {
    stubFetch([
      ["https://nominatim.openstreetmap.org/reverse", { category: "amenity", geojson: { type: "Point" }, address: {} }],
      ["https://overpass-api.de", { elements: [{ id: 3, tags: { "addr:street": "Side", "addr:housenumber": "2" }, geometry: [{ lat: 50, lon: 8 }] }] }],
    ]);
    expect(await buildingAt(50.5, 8.5)).toEqual({ name: "Side 2", id: 3, ring: [[50, 8]] });
  });
});

describe("streetsIn", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("the ways' kinds and lines, rounded to 6 decimals; a one-point way is dropped", async () => {
    const line = [
      { lat: 50.1234567, lon: 8.1 },
      { lat: 50.2, lon: 8.2 },
    ];
    const elements = [
      { tags: { highway: "residential" }, geometry: line },
      { tags: { highway: "footway", footway: "sidewalk" }, geometry: line },
      { geometry: [line[0]] },
    ];
    const calls = stubFetch([["https://overpass-api.de", { elements }]]);
    const road: [number, number][] = [
      [50.123457, 8.1],
      [50.2, 8.2],
    ];
    expect(await streetsIn([50, 8, 50.01, 8.01])).toEqual([
      { kind: "road", line: road },
      { kind: "sidewalk", line: road },
    ]);
    expect(calls).toHaveLength(1);
  });

  test("streetKind: a road's sidewalks and crossings (their own ways beside and across it) apart from roads and paths", () => {
    expect(streetKind({ highway: "residential", cycleway: "lane" })).toBe("road");
    expect(streetKind({ highway: "service", service: "driveway" })).toBe("road");
    for (const tags of [{ footway: "sidewalk" }, { path: "sidewalk" }, { cycleway: "sidepath" }, { is_sidepath: "yes" }])
      expect(streetKind({ highway: "path", ...tags })).toBe("sidewalk");
    for (const tags of [{ footway: "crossing" }, { cycleway: "crossing" }, { path: "traffic_island" }])
      expect(streetKind({ highway: "footway", ...tags })).toBe("crossing");
    expect(streetKind({ highway: "footway" })).toBe("path"); // into a courtyard, across a park
    expect(streetKind({ highway: "pedestrian" })).toBe("path"); // a car-free street
  });

  test("a box over 3 km is not asked for, a refusal is a readable error", async () => {
    const calls = stubFetch([]);
    await expect(streetsIn([50, 8, 50.1, 8.01])).rejects.toThrow("11 km");
    expect(calls).toHaveLength(0);
    await expect(streetsIn([50, 8, 50.01, 8.01])).rejects.toThrow("refused the streets");
  });
});

test("searchAddress: first hit, or null", async () => {
  stubFetch([["https://nominatim.openstreetmap.org/search", [{ lat: "50.1", lon: "8.6" }]]]);
  expect(await searchAddress("Frankfurt")).toEqual([50.1, 8.6]);
  stubFetch([["https://nominatim.openstreetmap.org/search", []]]);
  expect(await searchAddress("nowhere")).toBeNull();
  vi.unstubAllGlobals();
});

test("pickForest: the nearest forest of some size, else the biggest; its centre and name", () => {
  const box = (lat: number, lon: number, d: number, name: string) => ({ tags: { name }, bounds: { minlat: lat, minlon: lon, maxlat: lat + d, maxlon: lon + d } });
  const tiny = box(50.0, 8.0, 0.001, "Copse"); // ~0.8 ha, right by it
  const far = box(50.2, 8.2, 0.03, "Big wood"); // ~700 ha, ~27 km away
  const near = box(50.05, 8.05, 0.01, "Near wood"); // ~80 ha, ~6 km away
  const f = pickForest([tiny, far, near], 50.0, 8.0)!;
  expect(f.name).toBe("Near wood");
  expect(f.lat).toBeCloseTo(50.055, 9);
  expect(f.lon).toBeCloseTo(8.055, 9);
  expect(pickForest([tiny], 50.0, 8.0)?.name).toBe("Copse"); // none big enough: the biggest there is
  expect(pickForest([], 50.0, 8.0)).toBeNull();
});
