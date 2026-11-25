/**
 * How a heat source or sink is drawn on the Site map (as in HeatTransPlan): bubble size = power, scaled
 * across all bubbles on the map; colour strength = temperature on a fixed scale, so a colour means the same
 * on every map. Red family for the source, blue for sinks.
 */

export const R_MIN = 7; // px
export const R_MAX = 22; // px
const T_LO = 10; // °C: palest
const T_HI = 90; // °C: deepest

/** Fill and outline colour of a bubble at a temperature (clamped to 10..90 °C). */
export function bubbleColor(kind: "source" | "sink", tempC: number): { fill: string; stroke: string } {
  const t = Math.max(0, Math.min(1, (tempC - T_LO) / (T_HI - T_LO)));
  if (kind === "source") {
    const gb = Math.round(150 - t * 150);
    return { fill: `rgb(255,${gb},${gb})`, stroke: "#7f1d1d" };
  }
  return { fill: `rgb(${Math.round(150 - t * 130)},${Math.round(190 - t * 150)},255)`, stroke: "#1e3a8a" };
}

/** Radius (px) of a bubble by its power, linear between the smallest and biggest power on the map. */
export function radiusScale(powersKw: number[]): (kw: number) => number {
  const lo = Math.min(...powersKw);
  const hi = Math.max(...powersKw);
  return (kw) => (hi === lo ? (R_MIN + R_MAX) / 2 : R_MIN + ((kw - lo) / (hi - lo)) * (R_MAX - R_MIN));
}
