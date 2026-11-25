/**
 * A heat sink's profile at a glance, for the Site map's tooltips: what each month of a typical year holds (its
 * annual demand spread by its profile: lib/profilePresets.ts sinkPreset, on the typical Frankfurt year's weather),
 * drawn as twelve small bars in an inline SVG, and its average day in January and in July, hour by hour, from the same
 * year. Pure; computed when a popup opens, never for the whole map (but the peak hour, bubbleKw, which sizes the
 * bubbles: sinkKw, its shapes cached).
 */
import { fmt } from "../../lib/format";
import type { DemandEntry, DistrictSettings } from "../../lib/demand";
import { annualMwh, syntheticOutdoor } from "../../lib/demand";
import { localDate } from "../../lib/clock";
import { generate, perMonth } from "../../lib/profile";
import { PROFILE_PRESETS, sinkPreset } from "../../lib/profilePresets";
import { sinkKw } from "./quickAnalysis";

const YEAR = [Date.UTC(2025, 0, 1) / 1000, Date.UTC(2026, 0, 1) / 1000] as const;

type Sink = Pick<DemandEntry, "id" | "name" | "settings">;

/** Its hourly year (kW): its annual demand spread by its profile over the typical year. */
const yearOf = (e: Sink) => generate(sinkPreset(e).spec, YEAR[0], YEAR[1], 1, syntheticOutdoor); // MWh a year

/** MWh in each month of the typical year, January first. */
export function monthsOf(e: Sink): number[] {
  const y = yearOf(e);
  return perMonth(y.times, y.kw, 1);
}

/** Its average day in January and in July: kW at each hour 0..23 (the mean over the month's days). */
export function daysOf(e: Sink): { winter: number[]; summer: number[] } {
  const y = yearOf(e);
  const day = (month: number) => {
    const sum = new Array<number>(24).fill(0);
    const n = new Array<number>(24).fill(0);
    y.times.forEach((t, i) => {
      if (new Date(t * 1000).getUTCMonth() !== month) return;
      const h = localDate(t).getUTCHours(); // the local hour, as the profile's
      sum[h] += y.kw[i];
      n[h]++;
    });
    return sum.map((s, h) => (n[h] ? (1000 * s) / n[h] : 0)); // the year is in MWh, so its rate in MW: kW
  };
  return { winter: day(0), summer: day(6) };
}

/** The two days as lines over 24 hours (January in the heat colour, July lighter), the highest kW on top. */
export function daySvg({ winter, summer }: { winter: number[]; summer: number[] }): string {
  const top = Math.max(...winter, ...summer, 1e-9);
  const line = (kw: number[], colour: string) =>
    `<polyline fill="none" stroke="${colour}" stroke-width="1.8" points="${kw.map((v, h) => `${(h * 156) / 23},${40 - (v / top) * 36}`).join(" ")}"/>`;
  const ticks = [0, 6, 12, 18, 23]
    .map((h) => `<text x="${Math.min(150, Math.max(4, (h * 156) / 23))}" y="50" font-size="8" text-anchor="middle" fill="#64748b">${h === 23 ? 24 : h}</text>`)
    .join("");
  return `<svg width="156" height="52" viewBox="0 0 156 52" role="img" aria-label="kW over a day">${line(summer, "#fdba74")}${line(winter, "#f97316")}${ticks}</svg>`;
}

/** What a sink counts as in every calculation: its annual demand, its peak hour on the typical year and the supply it
 * needs, all from its demand's settings (its bubble's temp_c and power_kw are read by none). */
export function sinkFigures(s: DistrictSettings) {
  return { mwh: annualMwh(s), peakKw: sinkKw(s).reduce((a, b) => Math.max(a, b), 0), supply: s.supplyTemp };
}

/** The kW a bubble on the map is sized by (bubbles.ts radiusScale): a sink's peak hour (sinkFigures, as its row and
 * tooltip say), the data center's power_kw (`e` undefined: no demand). */
export const bubbleKw = (p: { power_kw: number }, e: Pick<DemandEntry, "settings"> | undefined) => (e ? sinkFigures(e.settings).peakKw : p.power_kw);

/** Those in a line, for its tooltip: "70 °C · peak 4,8 kW" (a decimal below 10 kW). */
export function sinkLine(s: DistrictSettings): string {
  const f = sinkFigures(s);
  return `${fmt(f.supply)} °C · peak ${fmt(f.peakKw, f.peakKw < 10 ? 1 : 0)} kW`;
}

/** The name of the profile a sink follows. */
export const profileName = (id?: string) => PROFILE_PRESETS.find((p) => p.id === id)?.label ?? "Automatic";

/** Twelve bars, J to D, the tallest the full height; the heat colour (SVG in a tooltip reads no CSS variables). */
export function monthsSvg(mwh: number[]): string {
  const top = Math.max(...mwh, 1e-9);
  const bars = mwh
    .map((v, i) => {
      const h = Math.max(1, Math.round((v / top) * 36));
      return `<rect x="${i * 13}" y="${40 - h}" width="10" height="${h}" rx="1.5" fill="#f97316"><title>${fmt(v)} MWh</title></rect>`;
    })
    .join("");
  const ticks = "JFMAMJJASOND"
    .split("")
    .map((m, i) => `<text x="${i * 13 + 5}" y="50" font-size="8" text-anchor="middle" fill="#64748b">${m}</text>`)
    .join("");
  return `<svg width="156" height="52" viewBox="0 0 156 52" role="img" aria-label="MWh per month">${bars}${ticks}</svg>`;
}

/** A sink's profile for its popup: its name, the year's total, the months, and its average day in January and July. */
export function profileHtml(e: Sink): string {
  const months = monthsOf(e);
  const year = months.reduce((a, b) => a + b, 0);
  const days = daysOf(e);
  return (
    `<div class="site__tip-profile">${profileName(e.settings.profile)} · ${fmt(year)} MWh/a<br>${monthsSvg(months)}</div>` +
    `<div class="site__tip-profile">${`A day: up to ${fmt(Math.max(...days.winter))} kW in January, ${fmt(Math.max(...days.summer))} kW in July`}<br>${daySvg(days)}</div>`
  );
}
