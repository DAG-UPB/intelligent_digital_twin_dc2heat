import { expect, test } from "vitest";
import { approachOf, choicesOf, shownApproaches, startOf, whyNot } from "./approaches";

const plain = { calculated: false, noData: false, input: false };

test("choicesOf: calculated none, no data never learned, an input from the data or a profile", () => {
  expect(choicesOf({ ...plain, calculated: true })).toEqual([]);
  expect(choicesOf({ ...plain, noData: true })).toEqual(["profile", "physics", "off"]);
  expect(choicesOf({ ...plain, input: true })).toEqual(["data", "profile", "off"]);
  expect(choicesOf(plain)).toEqual(["data", "physics", "profile", "off"]);
});

test("approachOf: the choice if allowed, else the structure's start, else the default; inputs stay from the data", () => {
  expect(approachOf(plain, undefined, "data")).toBe("data");
  expect(approachOf(plain, undefined, "physics")).toBe("physics");
  expect(approachOf(plain, "data", "physics")).toBe("data"); // moved
  expect(approachOf({ ...plain, input: true }, undefined, "profile")).toBe("data");
  expect(approachOf({ ...plain, input: true }, "physics", "physics")).toBe("data"); // not allowed for an input
  expect(approachOf({ ...plain, noData: true }, undefined, "data")).toBe("profile");
  expect(approachOf({ ...plain, noData: true }, undefined, "physics")).toBe("physics");
  expect(approachOf({ ...plain, input: true }, "off", "data")).toBe("off");
  expect(approachOf({ ...plain, calculated: true }, "data", "data")).toBeNull();
});

test("whyNot: no data is never learned, an input has no causes, anything else may go anywhere", () => {
  expect(whyNot({ ...plain, noData: true }, "data")).toMatch(/no data/);
  expect(whyNot({ ...plain, noData: true }, "physics")).toBeNull();
  expect(whyNot({ ...plain, input: true }, "data")).toMatch(/no causes/);
  expect(whyNot({ ...plain, input: true }, "physics")).toMatch(/no causes/);
  expect(whyNot({ ...plain, input: true }, "profile")).toBeNull();
  for (const a of ["data", "physics", "profile", "off"] as const) expect(whyNot(plain, a)).toBeNull();
});

test("startOf: the district models only its heat demand, as a profile", () => {
  expect(startOf("district", "Q_houses", "Q_houses")).toBe("profile");
  expect(startOf("district", "n_units", "Q_houses")).toBe("off");
  expect(startOf("dc", "Q_houses", "Q_houses")).toBe("data");
  expect(startOf("heat", "T_dh_supply")).toBe("physics");
});

test("shownApproaches: as Modelling shows them; a left-out data column not modelled, an input from the data under Not modelled, a calculated one null", () => {
  const d = {
    columns: ["a", "b", "u", "q", "c"],
    modelled: ["a", "b", "u", "c"], // q: calculated
    inputs: ["u"],
    used: ["a", "b", "u"], // c: left out of the training
    chosen: { b: "physics" as const, x: "profile" as const },
    scope: "dc" as const,
  };
  expect(shownApproaches(d, ["a", "b", "u", "q", "c", "x", "y"])).toEqual({ a: "data", b: "physics", u: "off", q: null, c: "off", x: "profile", y: "profile" });
  expect(shownApproaches({ ...d, chosen: { u: "profile" } }, ["u"])).toEqual({ u: "profile" }); // an input given a profile
  expect(shownApproaches({ ...d, scope: "district", demand: "Q_houses", columns: [], modelled: [], used: [] }, ["Q_houses", "z"])).toEqual({
    Q_houses: "profile",
    z: "off",
  });
});
