/**
 * District heat demand: a profile generator (houses x annual demand, shaped by the weather and
 * by typical daily curves). Later: imported district-heating data or a predictive model.
 *
 * kW per step over the evaluated period (the data center's test period, at its own resolution), on the
 * same timestamps and outdoor temperature as the data center's data, so both can be matched step by step.
 * Outdoor temperature (site.json `outdoor`): Out_Temp, else temperature_2m, else a synthetic Frankfurt-like curve; or Open-Meteo at the site.
 *
 *   space heating(t) ~ max(0, heating limit - T_out, 24 h mean) x daily curve(t)
 *   hot water(t)     ~ hot-water daily curve(t)                 (all year)
 * scaled so a year sums to houses x kWh per house (split by the hot-water share); a shorter period holds its part of it
 * by its weather, the rest of the year weighed on the typical year.
 * Pure: loading the period and saving the settings live in demandStore.ts.
 */
import type { DistrictSettings, OutdoorChoice, Site } from "../api";
import { HOURS_PER_YEAR } from "./constants";
import { localDate, stepHoursOf } from "./clock";

export type { DistrictSettings, OutdoorChoice }; // wire types of site.json, in api/site.ts; kept here for their callers

export const DEFAULT_DISTRICT: DistrictSettings = {
  houses: 200,
  kwhPerHouse: 12000,
  heatingLimit: 15,
  dhwShare: 0.2,
  morningPeak: 0.6,
  eveningPeak: 0.5,
  nightSetback: 0.3,
  weekendFactor: 1.05,
  supplyTemp: 70,
  returnTemp: 40,
};

const gauss = (h: number, mu: number, sd: number) => Math.exp(-0.5 * ((h - mu) / sd) ** 2);

/** Weekend: the morning is ~2 h later. Maps a weekend hour to the weekday hour whose demand it takes. */
function weekendHour(hour: number, from: number, to: number) {
  if (hour <= 4 || hour >= 12) return hour;
  return hour < to ? 4 + ((hour - 4) * (from - 4)) / (to - 4) : from + ((hour - to) * (12 - from)) / (12 - to);
}

/** Points per drawn day: half-hourly. */
export const DAY_POINTS = 48;
/** A drawn day: 48 half-hourly points, or 24 hourly ones saved before. */
const isDrawn = (day?: number[]): day is number[] => day?.length === 48 || day?.length === 24;

/** A drawn daily curve (24 or 48 points) at a fractional hour (linear, wraps around midnight). */
function sample(day: number[], hour: number) {
  const n = day.length;
  const pos = (hour * n) / 24;
  const a = Math.floor(pos);
  return day[a % n] + (pos - a) * (day[(a + 1) % n] - day[a % n]);
}

/** Relative heating demand over a day (before scaling): the drawn curve, or base, night setback, morning and evening peaks. */
export function heatingCurve(hour: number, s: DistrictSettings, weekend = false) {
  const f = weekend ? s.weekendFactor : 1;
  if (isDrawn(s.heatingDay)) return sample(s.heatingDay, weekend ? weekendHour(hour, 6.5, 8.5) : hour) * f;
  const night = hour >= 22 || hour < 5 ? 1 - s.nightSetback : 1;
  const morning = s.morningPeak * gauss(hour, weekend ? 8.5 : 6.5, 1.3);
  const evening = s.eveningPeak * gauss(hour, 19, 1.8);
  return (night + morning + evening) * f;
}

/** Relative hot-water demand over a day: the drawn curve, or showers in the morning and evening. */
export function hotWaterCurve(hour: number, weekend = false, day?: number[]) {
  if (isDrawn(day)) return sample(day, weekend ? weekendHour(hour, 7, 9) : hour);
  return 0.25 + gauss(hour, weekend ? 9 : 7, 1) + 0.8 * gauss(hour, 20, 1.5);
}

/** 24 h mean outdoor temperature of the typical Frankfurt year on a (fractional) day of the year. */
const seasonalMean = (doy: number) => 10.5 - 9.5 * Math.cos((2 * Math.PI * (doy - 15)) / 365.25);

/** The typical winter day the heating curve is drawn for: 24 h mean outdoor temperature, °C. */
export const WINTER_DAY_C = 0;

/** Heating degree-days of the typical Frankfurt year below the heating limit (K·d). */
export const referenceHdd = (limit: number) => Array.from({ length: 365 }, (_, d) => Math.max(0, limit - seasonalMean(d + 0.5))).reduce((a, b) => a + b, 0);

/** Energy of a daily curve over 24 h (curve units x h), on 5-minute steps (exact for the drawn piecewise-linear curves). */
const dayIntegral = (f: (h: number) => number) => Array.from({ length: 288 }, (_, k) => f(k / 12)).reduce((a, b) => a + b, 0) / 12;

/** A daily curve's energy averaged over a week: 5 weekdays and 2 weekend days. */
const weekAverage = (f: (h: number, weekend: boolean) => number) => (5 * dayIntegral((h) => f(h, false)) + 2 * dayIntegral((h) => f(h, true))) / 7;

const heatingWeek = (s: DistrictSettings) => weekAverage((h, we) => heatingCurve(h, s, we));
const hotWaterWeek = (s: DistrictSettings) => weekAverage((h, we) => hotWaterCurve(h, we, s.hotWaterDay));

/**
 * The typical day of a demand in kW, 48 half-hourly points: space heating on a winter weekday and a winter
 * weekend day (24 h mean WINTER_DAY_C), and hot water on a weekday. Their height is the annual demand
 * (houses x kWh per house, split by the hot-water share) spread over the typical Frankfurt year: heating
 * degree-days for space heating, 365 days for hot water.
 */
export function typicalDayKw(s: DistrictSettings) {
  const annual = s.houses * s.kwhPerHouse;
  const hw = hotWaterWeek(s);
  const hsh = heatingWeek(s) * referenceHdd(s.heatingLimit);
  const kSh = hsh ? (annual * (1 - s.dhwShare) * Math.max(0, s.heatingLimit - WINTER_DAY_C)) / hsh : 0;
  const kHw = hw ? (annual * s.dhwShare) / (365 * hw) : 0;
  const at = (f: (h: number) => number) => Array.from({ length: DAY_POINTS }, (_, i) => f((i * 24) / DAY_POINTS));
  return {
    heating: at((h) => kSh * heatingCurve(h, s)),
    weekend: at((h) => kSh * heatingCurve(h, s, true)),
    hotWater: at((h) => kHw * hotWaterCurve(h, false, s.hotWaterDay)),
  };
}

/**
 * The settings for a newly drawn kW day (48 points) of heating or hot water: the curve becomes the shape, and
 * the annual demand follows from its height (kWh per house and the hot-water share); the other curve keeps its kW.
 * The inverse of typicalDayKw.
 */
export function drawDay(s: DistrictSettings, key: "heatingDay" | "hotWaterDay", kw: number[]): Partial<DistrictSettings> {
  const annual = s.houses * s.kwhPerHouse;
  const next = { ...s, [key]: kw.map((v) => Math.max(0, v)) };
  const degrees = Math.max(0, s.heatingLimit - WINTER_DAY_C);
  const sh = key === "heatingDay" ? (degrees ? (heatingWeek(next) * referenceHdd(s.heatingLimit)) / degrees : 0) : annual * (1 - s.dhwShare);
  const hw = key === "hotWaterDay" ? 365 * hotWaterWeek(next) : annual * s.dhwShare;
  const total = sh + hw;
  return {
    [key]: next[key],
    kwhPerHouse: Math.round(total / Math.max(1, s.houses)),
    dhwShare: total ? hw / total : s.dhwShare,
  };
}

/** Each step's relative space heating (max(0, heating limit - trailing 24 h mean) x heating curve) and hot water; the
 * first day's steps take the first 24 h's mean. */
function weightsOf(s: DistrictSettings, times: number[], outTemp: number[], stepHours: number) {
  const n = times.length;
  // buildings follow the mean temperature of the last 24 h, not every swing (prefix sums: fast for 5 s steps)
  const w = Math.max(1, Math.round(24 / stepHours));
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + outTemp[i]);
  const sh: number[] = [];
  const dhw: number[] = [];
  // the first day has no 24 h behind it: the day before the start is taken as its own first day (the mean of the
  // first 24 h), not the few hours since the start (a winter night alone overstates the first morning)
  const first = pre[Math.min(n, w)] / Math.min(n, w);
  for (let i = 0; i < n; i++) {
    const a = i - w + 1;
    const daily = a < 0 ? first : (pre[i + 1] - pre[a]) / w;
    const d = localDate(times[i]); // Frankfurt's clock: people heat and shower by it
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; // the daily curves at the fractional hour
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    sh.push(Math.max(0, s.heatingLimit - daily) * heatingCurve(hour, s, weekend));
    dhw.push(hotWaterCurve(hour, weekend, s.hotWaterDay));
  }
  return { sh, dhw };
}

const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * District demand in kW at the given timestamps (unix seconds, any regular step) and outdoor temperatures (°C).
 * stepHours defaults to the median spacing of the timestamps.
 * A period shorter than a year gets its part of the annual demand by its weather: the rest of the year (up to
 * a year after the first step) is weighed hourly on the typical year (syntheticOutdoor), so January holds more
 * than June and a summer period has almost no heating. A year or more: annual x hours / 8760.
 */
export function districtProfile(s: DistrictSettings, times: number[], outTemp: number[], stepHours = stepHoursOf(times)): number[] {
  const n = times.length;
  if (!n) return [];
  const { sh, dhw } = weightsOf(s, times, outTemp, stepHours);
  const annual = s.houses * s.kwhPerHouse;
  let total = annual * ((n * stepHours) / HOURS_PER_YEAR); // kWh over the period
  let shSum = sumOf(sh) * stepHours;
  let dhwSum = sumOf(dhw) * stepHours;
  const spanH = (times[n - 1] - times[0]) / 3600 + stepHours; // the period's hours, its gaps included
  if (spanH < HOURS_PER_YEAR) {
    const from = times[n - 1] + stepHours * 3600;
    const rest = Array.from({ length: Math.max(0, Math.floor((times[0] + HOURS_PER_YEAR * 3600 - from) / 3600)) }, (_, i) => from + i * 3600);
    // the hours missing between the steps are the rest of the year too: else the year's total lands on fewer hours
    for (let i = 1; i < n; i++) for (let t = times[i - 1] + stepHours * 3600; t < times[i] - 1; t += 3600) rest.push(t);
    const r = weightsOf(s, rest, syntheticOutdoor(rest), 1);
    total = annual;
    shSum += sumOf(r.sh); // x 1 h
    dhwSum += sumOf(r.dhw);
  }
  // kWh in one step = kW x stepHours
  return sh.map((x, i) => (shSum ? (total * (1 - s.dhwShare) * x) / shSum : 0) + (dhwSum ? (total * s.dhwShare * dhw[i]) / dhwSum : 0));
}

/** Typical Frankfurt weather when the data has no outdoor temperature: ~1 °C in mid January, ~20 °C in mid July, ±4 K over the day. */
export function syntheticOutdoor(times: number[]): number[] {
  return times.map((t) => {
    const d = new Date(t * 1000);
    const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1) / 1000) / 86400;
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    return seasonalMean(doy) + 4 * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  });
}

/** Where the outdoor temperature came from: a data column, the synthetic year, or Open-Meteo at the site. */
export type Outdoor = "Out_Temp" | "temperature_2m" | "synthetic" | "open-meteo";

/**
 * Hourly values (e.g. Open-Meteo) at the given timestamps (unix seconds): linear between the hours, held
 * flat before the first and after the last. Both time lists ascending.
 */
export function alignToTimes(src: number[], values: number[], times: number[]): number[] {
  if (!src.length) return times.map(() => NaN);
  let j = 0;
  return times.map((t) => {
    while (j < src.length - 2 && src[j + 1] <= t) j++;
    if (t <= src[0]) return values[0];
    if (t >= src[src.length - 1]) return values[values.length - 1];
    const f = (t - src[j]) / (src[j + 1] - src[j]);
    return values[j] + f * (values[j + 1] - values[j]);
  });
}

/** The data center's location: its heat-source bubble, else the centre of its building outline (as backend/core/weather.py). */
export function siteLocation(site: Site): { lat: number; lon: number } | null {
  if (site.source) return { lat: site.source.lat, lon: site.source.lon };
  const ring = site.building?.outline ?? [];
  if (!ring.length) return null;
  return { lat: ring.reduce((a, p) => a + p[0], 0) / ring.length, lon: ring.reduce((a, p) => a + p[1], 0) / ring.length };
}

/** One demand of the district: a heat sink from the map, or the whole district when the map has none. */
export interface DemandEntry {
  id: string; // sink id, or WHOLE for site.district
  name: string;
  area: boolean; // a drawn district area (vs one building)
  settings: DistrictSettings;
}
export const WHOLE = "district";

/** Each sink's settings; a sink without its own starts from site.district's numbers (a building as one house). */
export function demandEntries(site: Site): DemandEntry[] {
  const base = { ...DEFAULT_DISTRICT, ...(site.district ?? {}) };
  if (!site.sinks.length) return [{ id: WHOLE, name: "Whole district", area: true, settings: base }];
  return site.sinks.map((p) => ({
    id: p.id,
    name: p.name,
    area: !!p.area,
    settings: { ...base, heatingDay: undefined, hotWaterDay: undefined, ...(p.area ? {} : { houses: 1 }), ...(p.demand ?? {}) },
  }));
}

export const isIncluded = (s: DistrictSettings) => s.included !== false;

/** Annual heat demand of one entry, MWh/a. */
export const annualMwh = (s: DistrictSettings) => (s.houses * s.kwhPerHouse) / 1000;

/** The settings of the included entry with the hottest supply: the network temperatures to meet (null: none included). */
export const hottestIncluded = (entries: DemandEntry[]) =>
  entries.reduce<DistrictSettings | null>((a, e) => (isIncluded(e.settings) && (!a || e.settings.supplyTemp > a.supplyTemp) ? e.settings : a), null);

/**
 * Sum of the included entries' profiles (kW per step, `n` steps) and the hottest included supply.
 * `profileOf` lets the caller pass cached profiles.
 */
export function combineDemand(entries: DemandEntry[], profileOf: (e: DemandEntry) => number[], n: number) {
  const kw = new Array<number>(n).fill(0);
  for (const e of entries) if (isIncluded(e.settings)) profileOf(e).forEach((v, i) => (kw[i] += v));
  return { kw, hottest: hottestIncluded(entries) };
}

/** Sum of the included demands' profiles, and the network temperatures to meet (the hottest included supply). */
export function totalDemand(entries: DemandEntry[], times: number[], outTemp: number[], stepHours = stepHoursOf(times)) {
  const { kw, hottest } = combineDemand(entries, (e) => districtProfile(e.settings, times, outTemp, stepHours), times.length);
  return { kw, settings: hottest ?? entries[0]?.settings ?? DEFAULT_DISTRICT };
}
