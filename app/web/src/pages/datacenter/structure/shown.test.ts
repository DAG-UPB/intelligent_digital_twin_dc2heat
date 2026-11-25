import { describe, expect, it } from "vitest";
import { defaultShown, MANY, shortNames, spotsInView } from "./shown";

describe("shown variables", () => {
  it("gives long names a short, unique label and keeps short ones", () => {
    const got = shortNames(["HEX_Cond_T_out", "Temperature_Supply_Hall_2", "Temperature_Supply_Hall_3", "chillerPowerConsumptionTotal"]);
    expect(got.HEX_Cond_T_out).toBe("HEX_Cond_T_out"); // 14: short enough
    expect(got.Temperature_Supply_Hall_2).toBe("Temp_Supp_Hall_2");
    expect(got.Temperature_Supply_Hall_3).toBe("Temp_Supp_Hall_3");
    expect(got.chillerPowerConsumptionTotal).toBe("chi_Pow_Con_Tot"); // camelCase words too
    expect(Object.values(got).every((s) => s.length <= 16)).toBe(true);
    // two names that shorten alike are told apart
    const same = shortNames(["Pump_Speed_Loop_A_Value", "Pump_Speed_Loop_A_Value2"]);
    expect(new Set(Object.values(same)).size).toBe(2);
  });

  it("shows a small graph whole, of a big one only what is placed", () => {
    const few = ["a", "b"];
    expect(defaultShown(few, {}, true, 500)).toEqual(few);
    const many = Array.from({ length: MANY + 1 }, (_, i) => `v${i}`);
    const pos = { v3: { x: 10, y: 100, tag: "TT" }, v4: { x: 10, y: 900, tag: "TT" } };
    expect(defaultShown(many, pos, true, 500)).toEqual(["v3"]);
  });

  it("puts variables that appear in free spots of the part in view", () => {
    const pos = { a: { x: 130, y: 130, tag: "TT" }, b: { x: 0, y: 9000, tag: "FT" }, c: { x: 0, y: 9000, tag: "PT" } };
    const got = spotsInView(["b", "c"], pos, { x0: 100, y0: 100, x1: 300, y1: 200 }, 60);
    expect(got.b).toEqual({ x: 190, y: 130, tag: "FT" }); // the first cell (130, 130) is a's
    expect(got.c).toEqual({ x: 250, y: 130, tag: "PT" });
    // all inside the area, also when there are more than cells
    const many = spotsInView(["b", "c", "d", "e", "f", "g", "h"], pos, { x0: 100, y0: 100, x1: 300, y1: 200 }, 60);
    expect(Object.values(many).every((p) => p.x >= 100 && p.x <= 300 && p.y >= 100 && p.y <= 200)).toBe(true);
  });
});
