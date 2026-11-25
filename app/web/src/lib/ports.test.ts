/** The connection points: how each variable is delivered, what is missing, the points of each part. */
import { describe, expect, test } from "vitest";
import type { DatasetConfig } from "../dataset";
import { dcPoints, deliveryOf, districtPoint, heatPoints, missingRoles } from "./ports";

describe("deliveryOf", () => {
  const approach = { T_in: "data", T_out: "off", m: "physics", Q: null, Out_Temp: "data", T_dh_supply: "off" } as const;
  const columns = ["T_in", "T_out", "m", "Q", "Out_Temp"];
  test("a modelled variable by its approach, a calculated one as calculated", () => {
    expect(deliveryOf("T_in", approach, columns, [])).toBe("data");
    expect(deliveryOf("m", approach, columns, [])).toBe("physics");
    expect(deliveryOf("Q", approach, columns, [])).toBe("calculated");
  });
  test("a data column left out, an input from the data or one outside the graph is measured", () => {
    expect(deliveryOf("T_out", approach, columns, [])).toBe("measured");
    expect(deliveryOf("Out_Temp", approach, columns, ["Out_Temp"])).toBe("measured");
    expect(deliveryOf("Out_Temp", {}, columns, [])).toBe("measured");
  });
  test("without data and not modelled: missing, or the part's setting when it has one", () => {
    expect(deliveryOf("T_dh_supply", approach, columns, [])).toBe("missing");
    expect(deliveryOf("T_dh_supply", approach, columns, [], "setting")).toBe("setting");
    expect(deliveryOf("T_outdoor", approach, columns, [], "weather")).toBe("weather");
    expect(deliveryOf(undefined, approach, columns, [])).toBe("missing");
  });
});

test("a point needs both temperatures and the heat or the flow", () => {
  expect(missingRoles({ t_supply: "data", t_return: "measured", m: "data" })).toEqual([]);
  expect(missingRoles({ t_supply: "data", q: "calculated" })).toEqual(["t_return"]);
  expect(missingRoles({ t_supply: "data", t_return: "missing", q: "missing", m: "missing" })).toEqual(["t_return", "q"]);
});

describe("the points of each part", () => {
  test("the data center's: its heat_source, else the saved mapping, else an empty one", () => {
    const config = {
      actuators: [],
      heat: [],
      levers: [],
      heat_source: { condenser: { q: "Q", t: "T_in", t_in: "T_in", t_out: "T_out", m: "m" } },
    } as unknown as DatasetConfig;
    expect(dcPoints(config, null)).toEqual([
      { id: "condenser", title: "Condenser HEX · cooling water", vars: { t_supply: "T_in", t_return: "T_out", q: "Q", m: "m" } },
    ]);
    expect(dcPoints(null, { kind: "column", q: "P", factor: 1, t: "T" })[0].vars).toEqual({ t_supply: "T", t_return: undefined, q: "P" });
    expect(dcPoints(null, null)[0].vars).toEqual({ t_supply: "T_dc_supply", t_return: "T_dc_return", q: "Q_dc", m: "m_dc" });
  });
  test("the heat distribution's take its structure's names, bound to the data", () => {
    const [dc, dh] = heatPoints((v) => (v === "T_dc_supply" ? "T_in" : v));
    expect(dc.vars).toEqual({ t_supply: "T_in", t_return: "T_dc_return", q: "Q_dc", m: "m_dc" });
    expect(dh.vars.q).toBe("Q_demand");
  });
  test("the district's is its demand and the network's water", () => {
    expect(districtPoint("Heat_Demand").vars).toEqual({ q: "Heat_Demand", t_supply: "T_dh_supply", t_return: "T_dh_return", m: "m_dh" });
  });
});
