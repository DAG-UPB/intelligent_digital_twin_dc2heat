/**
 * How a measured series follows the outdoor temperature, fitted from the data itself: the least-squares slope of y
 * on x (per K), over the steps where both have a value. Heat Matching's what-if shifts the weather: a part that runs
 * on measured data (the data center's waste heat and its water temperature, the district's measured demand) moves by
 * slope × shift, so every part reacts to the same weather, also where no model of its own is weather-driven. Pure.
 */

/** The slope of y on x, 0 without enough data or spread. */
export function slopeOn(y: readonly number[], x: readonly number[]): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++;
    sx += a;
    sy += b;
    sxx += a * a;
    sxy += a * b;
  }
  const den = n * sxx - sx * sx;
  return n < 3 || Math.abs(den) < 1e-9 ? 0 : (n * sxy - sx * sy) / den;
}

/** y moved by its fitted slope for an outdoor temperature `dT` K warmer (or colder), never below `floor`; `dT` one
 * number for every step, or one per step (shiftOf). */
export function withWeather(y: readonly number[], x: readonly number[], dT: number | readonly number[], floor = 0): number[] {
  const at = (i: number) => (typeof dT === "number" ? dT : (dT[i] ?? 0));
  if (typeof dT === "number" ? !dT : !dT.some((d) => d)) return [...y];
  const k = slopeOn(y, x);
  return y.map((v, i) => Math.max(floor, v + k * at(i)));
}

/** Where the what-if's temperature shift applies: all year, the heating season (October to April) or the summer. */
export type Season = "year" | "winter" | "summer";

/**
 * The what-if's weather change per step (K): `dT` in its `season`, plus a cold spell, the coldest 7 days of `outT`
 * (by their mean) `cold` K colder still. `times` in unix seconds, `stepHours` their step. Pure.
 */
export function shiftOf(times: readonly number[], outT: readonly number[], dT: number, season: Season, cold: number, stepHours: number): number[] {
  const winter = (t: number) => {
    const m = new Date(t * 1000).getUTCMonth(); // 0 January
    return m >= 9 || m <= 3;
  };
  const out = times.map((t) => (season === "year" || (season === "winter") === winter(t) ? dT : 0));
  const w = Math.round(168 / stepHours);
  if (cold && outT.length >= w && w > 0) {
    let sum = 0;
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < outT.length; i++) {
      sum += outT[i] ?? 0;
      if (i >= w) sum -= outT[i - w] ?? 0;
      if (i >= w - 1 && sum < best) [best, at] = [sum, i - w + 1];
    }
    for (let i = at; i < at + w; i++) out[i] -= cold;
  }
  return out;
}
