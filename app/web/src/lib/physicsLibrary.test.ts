/** The equation library: every template is consistent, columns are guessed in order, templates fill correctly. */
import { expect, test } from "vitest";
import { DISTRICT_LIBRARY } from "./districtLibrary";
import { HEAT_LIBRARY } from "./heatLibrary";
import { LIBRARY, fillEquation, guessColumn } from "./physicsLibrary";

test.each([
  ["data center", LIBRARY],
  ["heat distribution", HEAT_LIBRARY],
  ["district", DISTRICT_LIBRARY],
])("every %s library equation uses its slots and lists its coefficients", (_, library) => {
  expect(new Set(library.map((e) => e.id)).size).toBe(library.length);
  for (const eq of library) {
    for (const slot of Object.keys(eq.slots)) expect(eq.expr, `${eq.id} uses {${slot}}`).toContain(`{${slot}}`);
    const used = (eq.expr.match(/\{(\w+)\}/g) ?? []).map((s) => s.slice(1, -1)).filter((s) => s !== "self");
    for (const s of used) expect(eq.slots, `${eq.id} slot ${s}`).toHaveProperty(s);
    const names = eq.expr.replace(/\{\w+\}/g, "").match(/\b[A-Za-z_]\w*\b/g) ?? [];
    const coefs = names.filter((n) => !["maximum", "minimum", "exp", "log", "sqrt", "abs", "tanh", "sin", "cos", "clip"].includes(n));
    expect(new Set(coefs), eq.id).toEqual(new Set(Object.keys(eq.coefs)));
  }
});

test("guessColumn tries alternatives in order, keeps grouped patterns whole, falls back to the first column", () => {
  expect(guessColumn(/HEX_Cond_T_in|Out_Temp/, ["Out_Temp", "HEX_Cond_T_in"])).toBe("HEX_Cond_T_in");
  expect(guessColumn(/ITE_Ener|IT.*(Ener|Power)/i, ["x", "IT_Power"])).toBe("IT_Power");
  expect(guessColumn(/nothing/, ["a", "b"])).toBe("a");
});

test("fillEquation fills slots, self, and fixed coefficients (negative ones in parentheses)", () => {
  const tank = LIBRARY.find((e) => e.id === "tank")!;
  expect(fillEquation(tank, "T", { Q_in: "Qi", Q_out: "Qo", T_amb: "Ta" })).toBe("T[t-1] + a * (Qi[t-1] - Qo[t-1]) - b * (T[t-1] - Ta[t-1])");
  expect(fillEquation(tank, "T", { Q_in: "Qi", Q_out: "Qo", T_amb: "Ta" }, { a: -0.5 })).toBe("T[t-1] + (-0.5) * (Qi[t-1] - Qo[t-1]) - b * (T[t-1] - Ta[t-1])");
});

test("a fixed coefficient never touches a slot name inside braces", () => {
  const dry = LIBRARY.find((e) => e.id === "dry-cooler")!;
  expect(fillEquation(dry, "Tc", { T_air: "Out_Temp" }, { T_min: 12 })).toBe("maximum(Out_Temp[t-1] + approach, 12)");
});
