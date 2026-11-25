/** The built-in example data centers: positions in Frankfurt, labels, marker sizes. */
import { expect, test } from "vitest";
import { BUILT_IN_EXAMPLES, heatLabel, markerRadius } from "./frankfurtDataCenters";

test("every example data center sits in Frankfurt and has a heat figure with its basis and source", () => {
  for (const d of BUILT_IN_EXAMPLES) {
    expect(d.lat).toBeGreaterThan(50.0);
    expect(d.lat).toBeLessThan(50.23);
    expect(d.lon).toBeGreaterThan(8.47);
    expect(d.lon).toBeLessThan(8.81);
    expect(d.heatKw).toBeGreaterThan(0);
    expect(d.basis.length).toBeGreaterThan(5);
    expect(d.source).toMatch(/^https:\/\//);
  }
});

test("only the app's own datasets are built in (real sites are machine-local)", () => {
  expect(BUILT_IN_EXAMPLES.map((d) => (d.appDataset ? d.name : "not an app dataset"))).toEqual([
    "Simulation data center · European Central Bank",
    "MiniDC demonstrator · Evangelische Akademie Frankfurt",
  ]);
});

test("heat labels and marker sizes", () => {
  expect(heatLabel(0.5)).toBe("< 1 kW");
  expect(heatLabel(600)).toBe("600 kW");
  expect(heatLabel(1500)).toBe("1,5 MW");
  expect(heatLabel(21000)).toBe("21 MW");
  expect(markerRadius(600)).toBeGreaterThanOrEqual(6);
  expect(markerRadius(21000)).toBeGreaterThan(markerRadius(4000));
  expect(markerRadius(1e9)).toBe(22);
});

test("every example data center has its building outline, close to its marker", () => {
  for (const d of BUILT_IN_EXAMPLES) {
    expect(d.buildings?.length).toBeGreaterThan(0);
    for (const ring of d.buildings ?? []) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      const [la, lo] = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
      expect(Math.hypot((la - d.lat) * 111, (lo - d.lon) * 71)).toBeLessThan(0.3); // within 300 m (a campus can be large)
    }
  }
});
