/**
 * Learned heat profiles (AI: regressions learned from measured buildings): heat demand from the local hour of week and
 * the outdoor temperature, for any time step. Pure: no React, no fetching.
 *
 *   aalborg-residential (aalborgModel.json): homes, learned from 3,021 measured homes in Aalborg (2018-2020)
 *   helsinki-public (helsinkiPublicModel.json): offices, schools, day care, learned from 258 of the City of Helsinki's
 *     service buildings (2018, 2019, 2025)
 *
 * Why: reverse tests put the app's standard profiles on measured buildings. Over a district of homes the app's `residential`
 * curve missed by 40 % hourly CV(RMSE), BDEW by 17-19 %, the Aalborg model by 10-15 %; over Helsinki's offices, schools
 * and day-care centres BDEW GKO03 missed by 25-31 % (its peak by a third), the Helsinki model by 12-18 %.
 *
 * Both models share one set of features (fitted and exported by the fitting scripts, which also check them):
 *   hour of week (local time: Central European, with EU summer time)
 *   heating degrees of the outdoor temperature smoothed with half-lives 6, 24, 72 h (recursive filter on the step)
 *   hour of day x and Saturday / Sunday x heating degrees (24 h, 15 °C): the morning peak grows with the cold
 *   clear-sky irradiance of the date and place (24 h mean, with heating, now): sunny spring days need less heat
 * Data: Schaffer et al. 2022, Sci Data 9, 420 (CC-BY-4.0); City of Helsinki, Nuuka Open API (CC BY 4.0 per Helsinki
 * Region Infoshare); ERA5 via Open-Meteo (CC-BY-4.0).
 */
import aalborg from "./aalborgModel.json";
import helsinki from "./helsinkiPublicModel.json";
import { cetOffsetHours, localDate } from "./clock";

/** The coefficients of one learned model, and its check series (the JSON written by the fitting scripts, which also
 * carries the model's record: what it is, its source, its test). */
export interface LearnedModel {
  model: string;
  units: number;
  half_lives_h: number[];
  knots: number[];
  heating_limit: number;
  how: number[];
  hdd24: number[];
  hdd0_16: number;
  hdd6_16: number;
  hdd72_16: number;
  hod_x_hdd: number[];
  sat_x_hdd: number;
  sun_x_hdd: number;
  sol24: number;
  sol24_x_heat: number;
  sol_now: number;
  check: { lat: number; lon: number; times: number[]; temperature: number[]; kw: number[] };
}
export type LearnedModelId = "aalborg-residential" | "helsinki-public";

export const LEARNED_MODELS: Record<LearnedModelId, LearnedModel> = { "aalborg-residential": aalborg, "helsinki-public": helsinki };
export const AALBORG_MODEL = aalborg;
export const HELSINKI_MODEL = helsinki;

/** Frankfurt: the place the clear-sky irradiance is taken for when none is given (the app's examples are there). */
export const DEFAULT_PLACE = { lat: 50.11, lon: 8.68 };

const HOUR = 3600;

export { cetOffsetHours }; // moved to clock.ts, where the profiles read it too

/** Clear-sky global horizontal irradiance, W/m², in the middle of the hour starting at t (simple model, 75 % transmittance). */
export function clearSkyGhi(t: number, lat: number, lon: number): number {
  const mid = new Date((t + HOUR / 2) * 1000);
  const doy = Math.round((Date.UTC(mid.getUTCFullYear(), mid.getUTCMonth(), mid.getUTCDate()) - Date.UTC(mid.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const hour = mid.getUTCHours() + mid.getUTCMinutes() / 60;
  const rad = Math.PI / 180;
  const declination = 23.44 * rad * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const hourAngle = 15 * (hour + lon / 15 - 12) * rad;
  const phi = lat * rad;
  const cosZenith = Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
  const extraterrestrial = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365));
  return 0.75 * extraterrestrial * Math.max(0, cosZenith);
}

/** The outdoor temperature smoothed with a half-life (h), step by step (any step), started at the first value. */
function smooth(times: number[], temps: number[], halfLife: number): number[] {
  const out: number[] = [];
  let s = temps[0];
  times.forEach((t, k) => {
    if (k > 0) s += (1 - 2 ** (-(t - times[k - 1]) / HOUR / halfLife)) * (temps[k] - s);
    out.push(s);
  });
  return out;
}

/** Non-finite temperatures take the last known one (the first known one at the start). */
function filled(temps: number[]): number[] {
  const first = temps.find(Number.isFinite) ?? 10;
  let last = first;
  return temps.map((x) => (Number.isFinite(x) ? (last = x) : last));
}

/**
 * A learned model's heat demand at each step (unix seconds, any regular step) from the outdoor temperature (°C): the
 * Aalborg model in kW per household, the Helsinki model relative to a building's mean. Only the shape matters to the
 * profile generator, which scales it to the total.
 */
export function learnedKw(id: LearnedModelId, times: number[], outTemp: number[], place: { lat: number; lon: number } = DEFAULT_PLACE): number[] {
  const model = LEARNED_MODELS[id];
  const n = times.length;
  if (!n) return [];
  const temps = filled(outTemp);
  const [t6, t24, t72] = model.half_lives_h.map((hl) => smooth(times, temps, hl));
  const stepHours = n > 1 ? (times[n - 1] - times[0]) / (n - 1) / HOUR : 1;
  const window = Math.max(1, Math.round(24 / stepHours)); // the last 24 h, as the training's 24 rows
  const ghi = times.map((t) => clearSkyGhi(t, place.lat, place.lon) / 100);
  const pre = [0];
  ghi.forEach((g, i) => pre.push(pre[i] + g));
  return times.map((t, i) => {
    const local = localDate(t);
    const hour = local.getUTCHours();
    const dow = (local.getUTCDay() + 6) % 7; // Monday 0
    const heating = Math.max(model.heating_limit - t24[i], 0);
    const ghi24 = (pre[i + 1] - pre[Math.max(0, i + 1 - window)]) / Math.min(window, i + 1);
    let kw = model.how[dow * 24 + hour];
    model.knots.forEach((knot, k) => (kw += model.hdd24[k] * Math.max(knot - t24[i], 0)));
    kw += model.hdd0_16 * Math.max(16 - temps[i], 0) + model.hdd6_16 * Math.max(16 - t6[i], 0) + model.hdd72_16 * Math.max(16 - t72[i], 0);
    kw += model.hod_x_hdd[hour] * heating + (dow === 5 ? model.sat_x_hdd : dow === 6 ? model.sun_x_hdd : 0) * heating;
    kw += model.sol24 * ghi24 + (model.sol24_x_heat * ghi24 * Math.min(heating, 10)) / 10 + model.sol_now * ghi[i];
    return Math.max(0, kw);
  });
}
