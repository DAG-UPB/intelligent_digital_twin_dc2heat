import { expect, test } from "vitest";
import { applyMap, asHeatSourceMap, derivable, derivedQ, guessHeatSourceMap, hiddenColumns, mapColumns, otherOptionColumns } from "./sourceMap";

const columns = ["time", "ITE_Ener", "HEX_T_hot", "HEX_T_cold"];

test("a saved mapping is used only when all its columns exist", () => {
  const m = { kind: "column", q: "ITE_Ener", factor: 0.9, t: "HEX_T_hot" };
  expect(asHeatSourceMap(m, columns)).toEqual(m);
  expect(asHeatSourceMap({ ...m, q: "gone" }, columns)).toBeNull();
  expect(asHeatSourceMap({ kind: "other" }, columns)).toBeNull();
  expect(asHeatSourceMap(null, columns)).toBeNull();
  expect(asHeatSourceMap({ ...m, factor: NaN }, columns)).toBeNull();
});

test("first guess: a power column, else two temperatures", () => {
  expect(guessHeatSourceMap(columns, [])).toMatchObject({ kind: "column", q: "ITE_Ener" });
  expect(guessHeatSourceMap(["Hot_Temp", "Cold_Temp"], [])).toMatchObject({ kind: "delta", hot: "Hot_Temp", cold: "Cold_Temp", t: "Hot_Temp" });
  expect(guessHeatSourceMap(["a", "b"], [])).toBeNull();
  expect(guessHeatSourceMap(["HVAC_power", "ITE_power", "Room_Temp"], [])).toEqual({ kind: "column", q: "ITE_power", factor: 1, t: "Room_Temp" });
});

test("applyMap: column x factor, or factor x |hot - cold|", () => {
  const c = { q: [10, 20], hot: [40, 30], cold: [30, 35], t: [40, 30] };
  expect(applyMap({ kind: "column", q: "q", factor: 2, t: "t" }, c)).toEqual({ q: [20, 40], t: [40, 30] });
  expect(applyMap({ kind: "delta", hot: "hot", cold: "cold", factor: 3, t: "t" }, c).q).toEqual([30, 15]);
  expect(mapColumns({ kind: "delta", hot: "hot", cold: "cold", factor: 3, t: "hot" })).toEqual(["hot", "cold"]);
  // the return temperature: the measured outlet (t_out), or the delta's cold side
  expect(applyMap({ kind: "column", q: "q", factor: 1, t: "hot", t_out: "cold" }, c).tOut).toEqual([30, 35]);
  expect(mapColumns({ kind: "column", q: "q", factor: 1, t: "hot", t_out: "cold" })).toEqual(["q", "hot", "cold"]);
  expect(applyMap({ kind: "delta", hot: "hot", cold: "cold", factor: 3, t: "t" }, c).tOut).toEqual([30, 35]);
});

test("only the selected heat-recovery option's columns stay visible", () => {
  const hex = (k: string) => ({ q: `HEX_${k}_Q`, t: `HEX_${k}_T_in`, t_in: `HEX_${k}_T_in`, t_out: `HEX_${k}_T_out`, m: `HEX_${k}_m` });
  const hs = { hall: hex("Hall"), condenser: hex("Cond") };
  expect([...otherOptionColumns(hs, "condenser")].sort()).toEqual(["HEX_Hall_Q", "HEX_Hall_T_in", "HEX_Hall_T_out", "HEX_Hall_m"]);
  expect([...otherOptionColumns(hs, "hall")].sort()).toEqual(["HEX_Cond_Q", "HEX_Cond_T_in", "HEX_Cond_T_out", "HEX_Cond_m"]);
  // a column both options use stays; an unknown option or no heat_source hides nothing
  expect(otherOptionColumns({ a: { q: "Qa", t: "T" }, b: { q: "Qb", t: "T" } }, "a")).toEqual(new Set(["Qb"]));
  expect(otherOptionColumns(hs, "tank").size).toBe(0);
  expect(otherOptionColumns(null, "hall").size).toBe(0);
});

test("derived Q = m · cp · (T_in − T_out), and which can be computed", () => {
  const d = { m: "m", t_in: "a", t_out: "b", cp: 4.18 };
  expect(derivedQ(d, { m: [2, 0.5], a: [30, 40], b: [25, 30] })).toEqual([2 * 4.18 * 5, 0.5 * 4.18 * 10]);
  expect(derivable({ Q: d, Q2: { ...d, t_out: "c" } }, ["m", "a", "b"])).toEqual(["Q"]);
  expect(derivable(null, ["m"])).toEqual([]);
});

test("graph views hide the other option and every calculated column: three variables per HEX", () => {
  const hex = (k: string) => ({ q: `HEX_${k}_Q`, t: `HEX_${k}_T_in`, t_in: `HEX_${k}_T_in`, t_out: `HEX_${k}_T_out`, m: `HEX_${k}_m` });
  const der = (k: string, cp: number) => ({ m: `HEX_${k}_m`, t_in: `HEX_${k}_T_in`, t_out: `HEX_${k}_T_out`, cp });
  const config = { heat_source: { hall: hex("Hall"), condenser: hex("Cond") }, derived: { HEX_Hall_Q: der("Hall", 1.006), HEX_Cond_Q: der("Cond", 4.18) } };
  const all = ["Heat_Demand", ...["Hall", "Cond"].flatMap((k) => Object.values(hex(k)))];
  const hidden = hiddenColumns(config, "condenser");
  expect([...new Set(all.filter((c) => !hidden.has(c)))].sort()).toEqual(["HEX_Cond_T_in", "HEX_Cond_T_out", "HEX_Cond_m", "Heat_Demand"]);
  expect(hiddenColumns(null, "hall").size).toBe(0);
});
