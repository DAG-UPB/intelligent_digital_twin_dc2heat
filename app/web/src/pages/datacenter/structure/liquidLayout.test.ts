/** The liquid-cooled drawing: every variable of the water-cooled simulation has a spot, inside the frame, and taps
 * onto what it measures; the calculated heat Q has no instrument. */
import { expect, test } from "vitest";
import { H, tapFor, W } from "./geometry";
import { LIQUID_DEFAULTS, LIQUID_TAPS, LIQUID_UNITS } from "./liquidLayout";

test("spots for sim_1_water's variables, in the frame, tapping onto their units", () => {
  for (const v of [
    "HEX_Liq_T_in",
    "HEX_Liq_T_out",
    "HEX_Liq_m",
    "HEX_Cond_T_in",
    "HEX_Cond_T_out",
    "HEX_Cond_m",
    "FC_Share",
    "ITE_Ener",
    "Cool_Set",
    "HVAC_Ener",
  ]) {
    const p = LIQUID_DEFAULTS[v];
    expect(p, v).toBeDefined();
    expect(p.x > 0 && p.x < W && p.y > 0 && p.y < H, v).toBe(true);
    expect(tapFor(v, p.x, p.y, LIQUID_TAPS), v).not.toBeNull();
  }
  expect(Object.keys(LIQUID_DEFAULTS).filter((v) => v.endsWith("_Q"))).toEqual([]);
  expect(tapFor("Out_Temp", 90, 70, LIQUID_TAPS)).toBeNull(); // the weather taps onto nothing
  expect(Object.keys(LIQUID_UNITS)).not.toContain("crah");
  expect(Object.keys(LIQUID_UNITS)).toContain("tower"); // the same outdoor plant as the air-cooled one
});
