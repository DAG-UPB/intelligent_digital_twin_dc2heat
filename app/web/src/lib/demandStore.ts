/** Loading and saving the district demand: the parts of the demand model that touch the backend. */
import { fetchOpenMeteo, fetchSite, updateSite, type Site } from "../api";
import { DATASET } from "../dataset";
import { MODEL_NAME } from "./modelCatalog";
import { errorMessage } from "./errors";
import { alignToTimes, demandEntries, syntheticOutdoor, WHOLE, type DemandEntry, type DistrictSettings, type Outdoor, type OutdoorChoice } from "./demand";
import { siteDemand } from "./profilePresets";
import { periodColumns, testPeriod } from "./period";

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The evaluated period (the data center's test period) with its outdoor temperature, from the chosen source:
 * the data's column (else the synthetic year), the synthetic year, or Open-Meteo at the site (hourly, aligned
 * to the data's steps). When Open-Meteo cannot be had, the data's column is used and `weatherError` says why.
 */
export async function evaluatedYear(choice: OutdoorChoice = "data", model = MODEL_NAME): Promise<{ times: number[]; outTemp: number[]; split: number; stepHours: number; outdoor: Outdoor; weatherError?: string }> {
  const p = await testPeriod(DATASET, model); // the period of the data center's model: its heat and this demand pair step by step
  const base = { times: p.times, split: p.start, stepHours: p.stepHours };
  let weatherError: string | undefined;
  if (choice === "open-meteo" && p.times.length) {
    try {
      const w = await fetchOpenMeteo(p.dataset, day(p.times[0]), day(p.times[p.times.length - 1]));
      return { ...base, outTemp: alignToTimes(w.times, w.temperature, p.times), outdoor: "open-meteo" };
    } catch (e) {
      weatherError = `Open-Meteo: ${errorMessage(e)}. Using the data's outdoor temperature instead.`;
    }
  }
  const column = choice === "synthetic" ? undefined : (["Out_Temp", "temperature_2m"] as const).find((c) => p.columns.includes(c));
  const outTemp = column ? (await periodColumns(p, [column]))[column] : syntheticOutdoor(p.times);
  return { ...base, outTemp, outdoor: column ?? "synthetic", weatherError };
}

/** Saves each sink's settings, and its peak kW and supply temperature as the map bubble (peaks by id, when known), and the outdoor-temperature choice. */
export function saveDemand(entries: DemandEntry[], peaks: Record<string, number>, outdoor?: OutdoorChoice): Promise<Site> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const whole = byId.get(WHOLE);
  return updateSite(DATASET, (site) => ({
    ...site,
    outdoor: outdoor ?? site.outdoor,
    district: whole ? whole.settings : site.district,
    sinks: site.sinks.map((p) => {
      const e = byId.get(p.id);
      if (!e) return p;
      const peak = peaks[p.id];
      return { ...p, demand: e.settings, temp_c: e.settings.supplyTemp, power_kw: peak != null ? Math.round(peak) : p.power_kw };
    }),
  }));
}

/** The district's demand over the evaluated period, as saved: the sum of the included heat sinks, each by its profile. */
export async function districtYear(model = MODEL_NAME): Promise<{ times: number[]; kw: number[]; settings: DistrictSettings; stepHours: number; outTemp: number[]; outdoor: Outdoor }> {
  const site = await fetchSite(DATASET);
  const year = await evaluatedYear(site.outdoor, model);
  const { times, outTemp, stepHours, outdoor } = year;
  return { times, stepHours, outTemp, outdoor, ...siteDemand(demandEntries(site), times, outTemp, stepHours) };
}
