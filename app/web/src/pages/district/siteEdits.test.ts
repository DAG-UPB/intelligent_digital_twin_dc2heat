/** Site edits from map clicks: defaults of new sinks, areas and the data center's source. */
import { expect, test } from "vitest";
import type { Site } from "../../api";
import type { Building } from "./osm";
import { distanceM, profileFor, withArea, withBuilding, withSink } from "./siteEdits";

const empty: Site = { building: null, source: null, sinks: [] };
const b: Building = { name: "Tower", id: 5, ring: [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]] };

test("picking a building sets it and moves a default source to its centre", () => {
  const s = withBuilding(empty, b);
  expect(s.building).toEqual({ name: "Tower", osm_id: 5, outline: b.ring });
  expect(s.source).toEqual({ id: "dc", name: "Data center", temp_c: 35, power_kw: 40, utilization: 0.3, lat: 1, lon: 1 });
  expect(withBuilding({ ...s, source: { ...s.source!, power_kw: 99 } }, b).source?.power_kw).toBe(99);
});

test("a sink is the building, or a numbered bubble without one", () => {
  const one = withSink(empty, 5, 6, b).sinks[0];
  expect([one.name, one.lat, one.lon, one.temp_c, one.power_kw, one.outline]).toEqual(["Tower", 1, 1, 60, 100, b.ring]);
  const two = withSink(withSink(empty, 5, 6, b), 5, 6, null).sinks[1];
  expect([two.name, two.lat, two.lon, two.outline]).toEqual(["Heat sink 2", 5, 6, null]);
  expect(two.id).not.toBe(one.id);
});

test("an area becomes one numbered district sink at the corners' centre", () => {
  const corners: [number, number][] = [[0, 0], [0, 3], [3, 0]];
  const s = withArea(withArea(empty, corners), corners);
  expect(s.sinks.map((x) => x.name)).toEqual(["District 1", "District 2"]);
  expect(s.sinks[0]).toMatchObject({ lat: 1, lon: 1, temp_c: 70, power_kw: 500, area: true, outline: corners });
});

test("the distance between two points in metres", () => {
  expect(distanceM({ lat: 50, lon: 8 }, { lat: 50.01, lon: 8 })).toBeCloseTo(1112, 0); // 0.01° of latitude ≈ 1.1 km
});

test("a building added as a heat sink gets its type's profile: homes the Aalborg model, offices and public the Helsinki model, shops BDEW, industry flat", () => {
  expect(withSink(empty, 5, 6, { ...b, type: "apartments" }).sinks[0].demand?.profile).toBe("aalborg-residential");
  expect(withSink(empty, 5, 6, { ...b, type: "house" }).sinks[0].demand?.profile).toBe("aalborg-residential");
  expect(withSink(empty, 5, 6, { ...b, type: "office" }).sinks[0].demand?.profile).toBe("helsinki-public");
  expect(withSink(empty, 5, 6, { ...b, type: "school" }).sinks[0].demand?.profile).toBe("helsinki-public");
  expect(withSink(empty, 5, 6, { ...b, type: "industrial" }).sinks[0].demand?.profile).toBe("constant");
  expect(withSink(empty, 5, 6, { ...b, type: "retail" }).sinks[0].demand?.profile).toBe("bdew-gha03");
  expect(withSink(empty, 5, 6, { ...b, type: "yes" }).sinks[0].demand?.profile).toBe("aalborg-residential");
  expect(withSink(empty, 5, 6, null).sinks[0].demand).toBeUndefined(); // a bubble on open ground: as all
  expect(profileFor("MFH", "Wohngebäude")).toBe("aalborg-residential");
  expect(profileFor("EFH", "Wohngebäude")).toBe("aalborg-residential");
  expect(profileFor(null, "Bürogebäude")).toBe("helsinki-public");
  expect(profileFor("GHD", "Gebäude für Gewerbe und Industrie")).toBe("constant");
  expect(profileFor("GHD", "Gebäude für Wirtschaft oder Gewerbe")).toBe("helsinki-public"); // a named non-residential use
});
