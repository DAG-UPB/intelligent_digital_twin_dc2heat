/**
 * The Plattform für Abwärme's waste heat sources on the Site map, pure parts: a source's heat over the typical year
 * (its twelve months spread over the hours it is available), its colour by temperature and size by power, its tooltip.
 */
import type { HeatSource } from "../../api";
import { fmt } from "../../lib/format";
import { escapeHtml } from "./html";
import { HOURS, YEAR_TIMES, type QuickDc } from "./quickAnalysis";

export const MAX_BOX_KM = 40; // as PFA_MAX_BOX_KM in backend/core/limits.py
export const ATTRIBUTION = "Abwärme: Plattform für Abwärme © BfEE/BAFA, CC BY 4.0";
const START_H = 6; // a source available fewer than 24 h a day: from 6:00 on (the PfA gives the hours, not when)
const MONTH_HOURS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((d) => d * 24); // the typical year's (2025)

/** The mean temperature, else the middle of its range ("25 - 60 °C" → 42.5, ">=110 °C" → 110, "<25 °C" → 25). */
export function tempOf(s: Pick<HeatSource, "temp_c" | "temp_range">): number | null {
  if (s.temp_c != null && Number.isFinite(s.temp_c)) return s.temp_c;
  const n = (s.temp_range ?? "").match(/\d+(?:[.,]\d+)?/g)?.map((x) => Number(x.replace(",", ".")));
  return n?.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}

/**
 * The source's heat over the typical year, kW per hour: its year's MWh split by its twelve months (else evenly) over
 * the hours it is available: `hours_per_day` a day from START_H, not on weekends when it says so; at most its maximum
 * power (the month's rest is lost then). Its temperature flat (tempOf; null: none). The months give only the shape:
 * companies fill the "Leistungsprofil (in kW)" columns in different units (in Rhein-Main 651 of 758 far below the
 * year, as its header says a mean kW; 94 kWh a month that sum to the year), so the year's figure sets the amount;
 * without one the months count as the header says, mean kW over the month's hours. ponytail: no daily shape beyond
 * the hours.
 */
export function sourceYear(s: HeatSource): QuickDc & { tempC: number | null } {
  const months = s.months_mwh?.some((m) => m != null && m > 0) ? s.months_mwh.map((m) => Math.max(0, m ?? 0)) : null;
  const year = Math.max(0, s.mwh ?? 0);
  const shape = months ? months.reduce((a, b) => a + b, 0) : 0;
  // months_mwh holds the table's figure ÷ 1000: as mean kW, × the month's hours gives MWh
  const perMonth = months
    ? year > 0
      ? months.map((m) => (m / shape) * year)
      : months.map((m, i) => m * MONTH_HOURS[i])
    : Array<number>(12).fill(year / 12);
  const hoursADay = Math.min(24, Math.max(1, s.hours_per_day ?? 24));
  const max = s.max_kw != null && s.max_kw > 0 ? s.max_kw : Infinity;
  const on = new Uint8Array(HOURS);
  const month = new Uint8Array(HOURS);
  const count = new Array<number>(12).fill(0);
  for (let i = 0; i < HOURS; i++) {
    const d = new Date(YEAR_TIMES[i] * 1000);
    const wd = d.getUTCDay();
    const h = (d.getUTCHours() - START_H + 24) % 24;
    month[i] = d.getUTCMonth();
    on[i] = h < hoursADay && (s.weekend !== false || (wd !== 0 && wd !== 6)) ? 1 : 0;
    if (on[i]) count[month[i]]++;
  }
  const q = new Array<number>(HOURS).fill(0);
  for (let i = 0; i < HOURS; i++) if (on[i]) q[i] = Math.min(max, (perMonth[month[i]] * 1000) / count[month[i]]);
  const tempC = tempOf(s);
  return { q, t: new Array<number>(HOURS).fill(tempC ?? 0), tempC };
}

/** Colour by temperature: below a network's supply (heat pump), about it, hot enough to feed in directly. */
export const TEMP_CLASSES: { upTo: number; color: string; label: string }[] = [
  { upTo: 25, color: "#9ecae1", label: "< 25 °C" },
  { upTo: 60, color: "#fdae6b", label: "25–60 °C" },
  { upTo: 90, color: "#f16913", label: "60–90 °C" },
  { upTo: Infinity, color: "#a50f15", label: "≥ 90 °C" },
];
export const tempColor = (tC: number | null) => (tC == null ? "#969696" : TEMP_CLASSES.find((c) => tC < c.upTo)!.color);

/** Circle radius (px) by maximum power: 5 px at 100 kW and less, ~20 px at 50 MW (square root: area ∝ power). */
export const radiusOf = (kw: number | null) => Math.max(5, Math.min(22, 5 + Math.sqrt(Math.max(0, (kw ?? 0) - 100)) / 12));

/** The tooltip: who, what, how much, how hot, when. Every text from the table is escaped. */
export function sourceHtml(s: HeatSource): string {
  const e = (x: string | null) => escapeHtml(x ?? "");
  const t = tempOf(s);
  const when = [s.availability, s.hours_per_day != null ? `${fmt(s.hours_per_day)} h/day` : null, s.weekend === false ? "not on weekends" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    `<b>${e(s.name) || "Waste heat"}</b><br>${e(s.company)}${s.site ? ` · ${e(s.site)}` : ""}<br>` +
    `${fmt(s.mwh ?? 0)} MWh/a · up to ${fmt(s.max_kw ?? 0)} kW · ${t == null ? "temperature unknown" : `${fmt(t)} °C`}${s.temp_range ? ` (${e(s.temp_range)})` : ""}<br>` +
    (when ? `${e(when)}<br>` : "") +
    `${e(s.street)}, ${e(s.plz)} ${e(s.city)}${s.geo === "postcode" ? " (placed at its postcode only)" : ""}`
  );
}
