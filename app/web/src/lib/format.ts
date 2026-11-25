/** Number formatting shared by the pages. */

/** The numbers' format everywhere: German, points between the thousands and a decimal comma ("12.345,6"). */
export const LOCALE = "de-DE";

/**
 * `x` with exactly `d` decimals and thousands separators ("12.345,6"); "–" when it is not a finite number. A value
 * that rounds to zero shows without a sign (a float sum of -1e-12 is "0", not "-0").
 */
export const fmt = (x: number, d = 0) =>
  Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toLocaleString(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: d }) : "–";

/** A moment (unix ms) as a date and time on Frankfurt's clock, German: "24.11.2026, 14:35". */
export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString(LOCALE, { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** `x` with at most `d` decimals, trailing zeros dropped ("5,5", "5"; for durations and shares that read better short). */
export const fmtUpTo = (x: number, d: number) => (Number.isFinite(x) ? (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toLocaleString(LOCALE, { maximumFractionDigits: d }) : "–");

/** A day (unix ms) on Frankfurt's clock, German: "24.11.2026". */
export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(LOCALE, { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** A time of day (unix ms) on Frankfurt's clock: "14:35". */
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(LOCALE, { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
