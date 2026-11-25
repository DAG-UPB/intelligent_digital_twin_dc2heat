/**
 * Standard profiles for the profile generator (lib/profile.ts): demand (homes, offices, shops) and supply (a data
 * center's waste heat). The totals are only starting values: set your own.
 *
 * BDEW: BDEW/VKU/GEODE Leitfaden "Abwicklung von Standardlastprofilen Gas", Stand 27.03.2026, data sheets "TUM
 * Sigmoid" (Deutschland, bundesweit): coefficients A, B, C, D', T0 and the weekday factors F_WT (Monday first) as
 * published, 7 decimals. The linear part (mH, bH, mW, bW) is 0 for these profiles. They give a day's energy; within
 * the day the shape is flat, unless you draw one.
 */
import { fmt } from "./format";
import {
  annualMwh,
  combineDemand,
  DAY_POINTS,
  DEFAULT_DISTRICT,
  districtProfile,
  heatingCurve,
  hotWaterCurve,
  hottestIncluded,
  isIncluded,
  syntheticOutdoor,
  type DemandEntry,
  type DistrictSettings,
} from "./demand";
import { AALBORG_MODEL, HELSINKI_MODEL } from "./learnedModels";
import { FLAT, profileKw, type Driver, type ProfilePart, type ProfileSpec } from "./profile";

export interface ProfilePreset {
  id: string;
  label: string;
  about: string;
  source: string;
  spec: ProfileSpec;
}

const BDEW = 'BDEW/VKU/GEODE Leitfaden "Abwicklung von Standardlastprofilen Gas", Stand 27.03.2026, TUM Sigmoid data sheets';

const slp = (code: string, A: number, B: number, C: number, D: number): Driver => ({ kind: "slp", code, A, B, C, D, T0: 40, mH: 0, bH: 0, mW: 0, bW: 0 });
const half = (f: (hour: number) => number) => Array.from({ length: DAY_POINTS }, (_, i) => f((i * 24) / DAY_POINTS));
const S = DEFAULT_DISTRICT;

/** A heat sink's settings (site.json) as profile parts. With a standard profile chosen (`profile`, on the Site map,
 * for all sinks or one) its parts; else its curves (drawn or not) as two parts: space heating below its heating limit
 * and hot water all year, split by its hot-water share. `name` prefixes the labels. */
export function sinkParts(s: DistrictSettings, name?: string): ProfilePart[] {
  const chosen = s.profile ? PROFILE_PRESETS.find((p) => p.id === s.profile) : undefined;
  if (chosen) return chosen.spec.parts.map((p) => ({ ...p, label: name ? `${name} · ${p.label.toLowerCase()}` : p.label }));
  return curveParts(s, name);
}

const curveParts = (s: DistrictSettings, name?: string): ProfilePart[] => [
  {
    label: name ? `${name} · heating` : "Space heating",
    share: 1 - s.dhwShare,
    hour: half((h) => heatingCurve(h, s)),
    weekday: [1, 1, 1, 1, 1, s.weekendFactor, s.weekendFactor],
    month: FLAT.month,
    driver: { kind: "below", limit: s.heatingLimit },
  },
  {
    label: name ? `${name} · hot water` : "Hot water",
    share: s.dhwShare,
    hour: half((h) => hotWaterCurve(h, false, s.hotWaterDay)),
    weekday: FLAT.weekday,
    month: FLAT.month,
    driver: { kind: "none" },
  },
];

const mwh = (v: number) => fmt(v);
const ON_DEMAND = "As the heat sink's settings are saved (its curves, houses and kWh per house); start from it again after they change.";

/** One heat sink (a building or area) as a preset: its houses times its demand per house a year, in MWh (the city's
 * buildings are in the tens to thousands of MWh; kWh would be long numbers). */
export const sinkPreset = (e: Pick<DemandEntry, "id" | "name" | "settings">): ProfilePreset => ({
  id: `heat-demand:${e.id}`,
  label: `${e.name} · ${mwh(annualMwh(e.settings))} MWh/a`,
  about: ON_DEMAND,
  source: "The site's heat sinks (site.json)",
  spec: { total: e.settings.kwhPerHouse / 1000, unit: "MWh", per: "year", perUnit: true, units: e.settings.houses, parts: sinkParts(e.settings) },
});

/** A standard profile other than the app's own curves (`residential`, which are the sink's settings themselves). */
const standardOf = (s: DistrictSettings) => (s.profile && s.profile !== "residential" ? PROFILE_PRESETS.find((p) => p.id === s.profile) : undefined);

/**
 * The site's demand in kW over the steps (Heat Matching, Operation): each included sink by its standard profile, as
 * the Site map shows it, or by its curves when it has none (or the app's `residential`). One curve per standard
 * profile, scaled by each sink's annual energy: hundreds of buildings cost one model run each kind.
 */
export function siteDemand(entries: DemandEntry[], times: number[], outTemp: number[], stepHours: number) {
  const unit = new Map<string, number[]>(); // kW per kWh a year, by profile
  const kwOf = (e: DemandEntry) => {
    const chosen = standardOf(e.settings);
    if (!chosen) return districtProfile(e.settings, times, outTemp, stepHours);
    let curve = unit.get(chosen.id);
    if (!curve) {
      curve = profileKw({ ...chosen.spec, total: 1, unit: "kWh", perUnit: false, units: 1 }, times, outTemp, stepHours, syntheticOutdoor);
      unit.set(chosen.id, curve);
    }
    const annual = e.settings.houses * e.settings.kwhPerHouse;
    return curve.map((x) => x * annual);
  };
  const { kw } = combineDemand(entries, kwOf, times.length);
  return { kw, settings: hottestIncluded(entries) ?? entries[0]?.settings ?? DEFAULT_DISTRICT };
}

/** The heat sinks of the site (site.json) as presets: all included ones together (one part pair per sink, each by
 * its annual energy), then each sink on its own when there are several. */
export function sinkPresets(entries: DemandEntry[]): ProfilePreset[] {
  const on = entries.filter((e) => isIncluded(e.settings));
  const kwh = (e: DemandEntry) => e.settings.houses * e.settings.kwhPerHouse;
  const total = on.reduce((a, e) => a + kwh(e), 0);
  const all: ProfilePreset = {
    id: "heat-demand",
    label: `All heat sinks of the site (${on.length}) · ${mwh(total / 1000)} MWh/a`,
    about: ON_DEMAND,
    source: "The site's heat sinks (site.json)",
    spec: {
      total: total / 1000,
      unit: "MWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: on.flatMap((e) => sinkParts(e.settings, on.length > 1 ? e.name : undefined).map((p) => ({ ...p, share: p.share * (total ? kwh(e) / total : 1) }))),
    },
  };
  const each = entries.map(sinkPreset);
  return on.length ? [all, ...(entries.length > 1 ? each : [])] : each;
}

/** The standard profile of homes (lib/learnedModels.ts): what the Site map gives houses and flats. */
export const AALBORG_RESIDENTIAL = "aalborg-residential";
/** The standard profile of offices, schools and public buildings (lib/learnedModels.ts). */
export const HELSINKI_PUBLIC = "helsinki-public";
const H = HELSINKI_MODEL.test;

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: AALBORG_RESIDENTIAL,
    label: "Residential, measured: Aalborg model (AI)",
    about: `Learned from ${fmt(AALBORG_MODEL.units)} measured homes (Aalborg, 2018-2020): heating and hot water hour by hour from the outdoor temperature (smoothed over hours to days), the hour of the week (local time) and the season's sun; the morning peak grows with the cold. Checked on the following year: ${fmt(AALBORG_MODEL.test.cvrmse_hourly_pct)} % hourly, ${fmt(AALBORG_MODEL.test.cvrmse_daily_pct)} % daily error over a district, against 19 % and 15 % for BDEW. For one house no profile is close: there its annual demand counts.`,
    source: "Schaffer et al. 2022, Sci Data 9, 420 (CC-BY-4.0)",
    spec: {
      units: S.houses,
      total: S.kwhPerHouse,
      unit: "kWh",
      perUnit: true,
      per: "year",
      parts: [{ label: "Heating + hot water", share: 1, ...FLAT, driver: { kind: "learned", model: AALBORG_RESIDENTIAL } }],
    },
  },
  {
    id: HELSINKI_PUBLIC,
    label: "Offices, schools, public buildings, measured: Helsinki model (AI)",
    about: `Learned from ${fmt(HELSINKI_MODEL.units)} measured offices, schools and day-care centres (City of Helsinki, 2018, 2019, 2025): heating hour by hour from the outdoor temperature (smoothed over hours to days), the hour of the week (local time) and the season's sun; preheating on working mornings, less at night and at the weekend. Checked on buildings it had not seen: ${fmt(H.office.cvrmse_hourly_pct)} % hourly error over offices, ${fmt(H.school.cvrmse_hourly_pct)} % over schools, against ${fmt(H.office.bdew_gko03_cvrmse_hourly_pct)} % and ${fmt(H.school.bdew_gko03_cvrmse_hourly_pct)} % for BDEW, whose peak is a third too low. Learned in Finland's climate: the shape carries over, the response to the weather of German buildings is not checked.`,
    source: "City of Helsinki, Nuuka Open API (CC BY 4.0 per Helsinki Region Infoshare)",
    spec: {
      total: 100000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [{ label: "Heating + hot water", share: 1, ...FLAT, driver: { kind: "learned", model: HELSINKI_PUBLIC } }],
    },
  },
  {
    id: "residential",
    label: "Residential: space heating + hot water (this app's)",
    about: `Heating below ${S.heatingLimit} °C daily mean, with morning and evening peaks and a night setback; hot water all year, showers morning and evening. As on the heat sinks above.`,
    source: "This app's district demand (lib/demand.ts), its default settings",
    spec: {
      units: S.houses,
      total: S.kwhPerHouse,
      unit: "kWh",
      perUnit: true,
      per: "year",
      parts: curveParts(S),
    },
  },
  {
    id: "bdew-hef03",
    label: "BDEW gas SLP · household, single-family (DE_HEF03)",
    about: "Households below 50,000 kWh/a: heating and hot water from the allocation temperature (sigmoid); the same every weekday.",
    source: `${BDEW}, DE_HEF03`,
    spec: {
      total: 18000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [{ label: "Gas, heating + hot water", share: 1, ...FLAT, driver: slp("DE_HEF03", 3.0469695, -37.1833141, 5.6727847, 0.0961931) }],
    },
  },
  {
    id: "bdew-hmf03",
    label: "BDEW gas SLP · household, multi-family (DE_HMF03)",
    about: "Households from 50,000 kWh/a (multi-family buildings): a flatter sigmoid, more base load.",
    source: `${BDEW}, DE_HMF03`,
    spec: {
      total: 120000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [{ label: "Gas, heating + hot water", share: 1, ...FLAT, driver: slp("DE_HMF03", 2.3877618, -34.7213605, 5.8164304, 0.1208194) }],
    },
  },
  {
    id: "bdew-gko03",
    label: "BDEW gas SLP · offices, public bodies, banks (DE_GKO03)",
    about: "Public bodies, banks, insurers, non-profit organisations: lower on Saturdays and Sundays.",
    source: `${BDEW}, DE_GKO03`,
    spec: {
      total: 100000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [
        {
          label: "Gas, heating",
          share: 1,
          hour: FLAT.hour,
          weekday: [1.0354, 1.0523, 1.0449, 1.0494, 0.9885, 0.886, 0.9435],
          month: FLAT.month,
          driver: slp("DE_GKO03", 2.7172288, -35.1412563, 7.1303395, 0.1418472),
        },
      ],
    },
  },
  {
    id: "bdew-gha03",
    label: "BDEW gas SLP · retail and wholesale (DE_GHA03)",
    about: "Shops and wholesale: open on Saturdays, lowest on Sundays.",
    source: `${BDEW}, DE_GHA03`,
    spec: {
      total: 80000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [
        {
          label: "Gas, heating",
          share: 1,
          hour: FLAT.hour,
          weekday: [1.0358, 1.0232, 1.0252, 1.0295, 1.0253, 0.9675, 0.8935],
          month: FLAT.month,
          driver: slp("DE_GHA03", 3.5811214, -36.9650065, 7.2256947, 0.0448416),
        },
      ],
    },
  },
  {
    id: "dc-waste-heat",
    label: "Data center: waste heat (IT load)",
    about:
      "Nearly the same all year: the IT load turns almost all its power into heat, a little more in working hours and on weekdays. A starting shape for a data center's heat supply: draw your own, or use its measured data.",
    source: "A simple shape of this app, no standard",
    spec: {
      total: 8760,
      unit: "MWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [
        {
          label: "Waste heat",
          share: 1,
          hour: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 19 ? 1.04 : 0.97)),
          weekday: [1, 1, 1, 1, 1, 0.97, 0.96],
          month: FLAT.month,
          driver: { kind: "none" },
        },
      ],
    },
  },
  {
    id: "cooling",
    label: "Cooling on warm days (above 18 °C)",
    about: "Cooling degree-days: nothing at or below 18 °C daily mean, more the warmer the day; in working hours.",
    source: "A simple shape of this app (cooling degree-days), no standard",
    spec: {
      total: 20000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [
        {
          label: "Cooling",
          share: 1,
          hour: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 19 ? 1 : 0.3)),
          weekday: [1, 1, 1, 1, 1, 0.5, 0.5],
          month: FLAT.month,
          driver: { kind: "above", limit: 18 },
        },
      ],
    },
  },
  {
    id: "office-hours",
    label: "Office hours (no weather)",
    about: "Weekdays 8–18 h at full load, a fifth of it at night and at the weekend. A starting shape: draw your own.",
    source: "A simple shape of this app, no standard",
    spec: {
      total: 50000,
      unit: "kWh",
      per: "year",
      perUnit: false,
      units: 1,
      parts: [
        {
          label: "Load",
          share: 1,
          hour: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 18 ? 1 : 0.2)),
          weekday: [1, 1, 1, 1, 1, 0.2, 0.2],
          month: FLAT.month,
          driver: { kind: "none" },
        },
      ],
    },
  },
  {
    id: "constant",
    label: "Constant",
    about: "The same every step: the total spread evenly.",
    source: "This app",
    spec: { total: 8760, unit: "kWh", per: "year", perUnit: false, units: 1, parts: [{ label: "Load", share: 1, ...FLAT, driver: { kind: "none" } }] },
  },
];

/** A profile as the generator keeps it in this browser: the preset it started from and its settings. */
export type SavedProfile = { preset: string; spec: ProfileSpec };

/** The profile kept under `key`, or a new one from preset `initial` (among `all`, else the first standard one). */
export function loadProfile(key: string, initial: string, all: ProfilePreset[] = PROFILE_PRESETS): SavedProfile {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null") as SavedProfile | null;
    // saved before there was a unit and a choice of one total: kWh, per unit
    if (s?.spec?.parts?.length) return { ...s, spec: { ...s.spec, unit: s.spec.unit ?? "kWh", perUnit: s.spec.perUnit ?? true } };
  } catch {
    /* storage off or an old entry: start from the preset */
  }
  const p = all.find((x) => x.id === initial) ?? PROFILE_PRESETS[0];
  return { preset: p.id, spec: p.spec };
}
