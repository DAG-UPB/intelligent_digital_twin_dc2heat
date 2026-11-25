/**
 * Frankfurt's clock (CET, CEST in summer) for the time stamps, which are UTC (unix seconds): what people and buildings
 * live by, so a profile's hour of day, weekday, month and day boundaries are read on it, not on UTC. Fixed to Central
 * European time (EU summer time rule), as every site in the app is; the charts show the viewer's own zone instead.
 */

const HOUR = 3600;

/** Unix seconds of the last Sunday of a month (0-based) at 01:00 UTC: when EU summer time starts (March) or ends (October). */
function lastSundayAt1Utc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0, 1));
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1) / 1000;
}

/** Hours ahead of UTC in Central European time: 2 in summer time, else 1. */
export function cetOffsetHours(t: number): number {
  const year = new Date(t * 1000).getUTCFullYear();
  return t >= lastSundayAt1Utc(year, 2) && t < lastSundayAt1Utc(year, 9) ? 2 : 1;
}

/** The wall-clock seconds in Frankfurt at the UTC time t: read hour, weekday, date and month with getUTC*. */
const localSeconds = (t: number) => t + cetOffsetHours(t) * HOUR;

/** The wall-clock time in Frankfurt at t as a Date whose getUTC* fields are Frankfurt's (getUTCHours: the local hour). */
export const localDate = (t: number) => new Date(localSeconds(t) * 1000);

/** Median spacing of the timestamps (unix seconds), in hours; 1 when it cannot be told. */
export function stepHoursOf(times: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (!d.length) return 1;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] / 3600;
}
