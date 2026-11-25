/** The saved model names are a contract with the files on disk: pin them. */
import { expect, test } from "vitest";
import { KINDS, MODEL_ALL, MODEL_NAME, STRUCTS, STRUCTURES, TAG } from "./modelCatalog";

test("model names never change", () => {
  expect(MODEL_NAME).toBe("linear");
  expect(MODEL_ALL).toBe("linear_all");
  expect(STRUCTURES.map((s) => s.name)).toEqual(["linear", "linear_all", "xgb", "xgb_all", "phys", "sym", "tabpfn"]);
});

test("every model has a known kind and structure, a badge, and its own colour", () => {
  const kinds = KINDS.map((k) => k.id);
  const structs = STRUCTS.map((s) => s.id);
  for (const s of STRUCTURES) {
    expect(kinds).toContain(s.kind);
    expect(structs).toContain(s.structure);
    expect(TAG[s.kind].text).toBe(KINDS.find((k) => k.id === s.kind)!.short);
  }
  expect(new Set(STRUCTURES.map((s) => s.color)).size).toBe(STRUCTURES.length);
});
