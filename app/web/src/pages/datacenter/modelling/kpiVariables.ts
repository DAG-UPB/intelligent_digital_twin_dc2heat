/**
 * The data center's KPI variables (KpiCard, in the Modelling's sidebar): the same store and formulas as the
 * Dashboard's (dataset.json "kpi", backend core/summary.py kpi_columns + kpis), said as short formulas with the
 * bound names, and what a KPI still lacks.
 */
import type { KpiMapping } from "../../../api";
import type { Derived } from "../../../lib/sourceMap";
import type { KpiLine } from "../../../lib/partKpis";
import type { KpiColumns } from "../dashboard/whatIf";

export type { KpiLine }; // defined in lib/partKpis.ts (lib must not import pages); kept here for its callers

/** What each KPI means, for its info mark (the same KPIs and sources as backend core/summary.kpis). */
const ABOUT: Record<string, string> = {
  PUE: "Power Usage Effectiveness: the data center's electricity per unit of IT electricity. 1 is ideal (every kWh goes to the servers); lower is better. Partial here: IT + cooling only (ISO/IEC 30134-2).",
  ERF: "Energy Reuse Factor: the share of the data center's electricity that is reused as heat, from 0 (none) to 1 (all); higher is better (ISO/IEC 30134-6).",
  ERE: "Energy Reuse Effectiveness: PUE with the reused heat taken off. Equal to PUE without reuse, lower the more heat is reused, and it can drop below 1; lower is better (The Green Grid).",
};
/** PUE's info mark when the facility's other electricity is bound too: then it is the full one. */
const FULL_PUE =
  "Power Usage Effectiveness: the data center's electricity per unit of IT electricity. 1 is ideal (every kWh goes to the servers); lower is better. Full here: IT + cooling + the facility's other electricity (UPS and distribution losses, lighting, building), the total facility of ISO/IEC 30134-2.";

/** The draft the card edits: what the KPIs use now (kpi_columns, with the defaults it found). */
export function draftOf(c: KpiColumns): KpiMapping {
  return {
    it_power: c.it_power,
    cooling_power: c.cooling_power,
    other_power: c.other_power ?? [],
    heat_power: c.heat_power,
    heat_demand: c.heat_demand,
    power_unit: c.power_unit as KpiMapping["power_unit"],
  };
}

/** What Save writes: the draft, the saved alternative points (kpi "reuse") kept, and a reused heat left as it was
 * not pinned when it came from one of those points (the Scenarios' point choice keeps picking it). */
export function mappingToSave(draft: KpiMapping, cols: KpiColumns, saved: KpiMapping): KpiMapping {
  const heat = draft.heat_power ?? [];
  const asFound = !!cols.reuse_point && heat.join("\n") === cols.heat_power.join("\n");
  return { ...draft, heat_power: asFound ? [] : heat, ...(saved.reuse ? { reuse: saved.reuse } : {}) };
}

/** The ratio KPIs backend kpis() computes from the mapping (the energies are left out): every one needs the IT power. */
export function kpiFormulas(m: KpiMapping): KpiLine[] {
  const it = m.it_power ?? null;
  const cool = m.cooling_power ?? null;
  const heat = m.heat_power ?? [];
  const other = m.other_power ?? [];
  const reused = heat.length > 1 ? `(${heat.join(" + ")})` : (heat[0] ?? null);
  const total = () => [it, cool, ...other].join(" + "); // E_DC: with the facility's other power the total facility
  const line = (label: string, needs: [string, unknown][], formula: () => string): KpiLine => {
    const missing = needs.filter(([, v]) => !v).map(([n]) => n);
    return { label, formula: missing.length ? null : formula(), missing, about: label === "PUE" && other.length ? FULL_PUE : ABOUT[label] };
  };
  const IT: [string, unknown] = ["IT power", it];
  const COOL: [string, unknown] = ["cooling power", cool];
  const HEAT: [string, unknown] = ["reused heat", reused];
  return [
    line("PUE", [IT, COOL], () => `(${total()}) / ${it}`),
    line("ERF", [IT, COOL, HEAT], () => `${reused} / (${total()})`),
    line("ERE", [IT, COOL, HEAT], () => `(${total()} − ${reused}) / ${it}`),
  ];
}

/** Each bound variable's part in the KPIs, as the drawing's "KPI variables" button marks it: its role and the
 * KPIs it feeds now (only those kpiFormulas can compute), e.g. "IT power · PUE, ERF, ERE". A reused heat
 * calculated from its water (dataset.json "derived": ṁ·cₚ·ΔT, not drawn itself) marks the three it comes from. */
export function kpiUses(m: KpiMapping, derived: Record<string, Derived> = {}): Record<string, string> {
  const ok = new Set(
    kpiFormulas(m)
      .filter((l) => l.formula)
      .map((l) => l.label),
  );
  const feeds = (kpis: string[]) => kpis.filter((k) => ok.has(k)).join(", ") || "no KPI yet";
  const HEAT = ["ERF", "ERE"];
  const out: Record<string, string> = {};
  const mark = (v: string, text: string) => (out[v] = out[v] ? `${out[v]}; ${text}` : text);
  if (m.it_power) mark(m.it_power, `IT power · ${feeds(["PUE", "ERF", "ERE"])}`);
  if (m.cooling_power) mark(m.cooling_power, `Cooling power · ${feeds(["PUE", "ERF", "ERE"])}`);
  for (const o of m.other_power ?? []) mark(o, `Other facility power · ${feeds(["PUE", "ERF", "ERE"])}`);
  for (const q of m.heat_power ?? []) {
    const d = derived[q];
    for (const v of d ? [d.t_in, d.t_out, d.m] : [q]) mark(v, `Reused heat${d ? ` (${q} = ṁ·cₚ·ΔT)` : ""} · ${feeds(HEAT)}`);
  }
  return out;
}

/** Whether a kpiUses text says its variable feeds `kpi` ("IT power · PUE, ERF, ERE" feeds PUE, not "PU"). */
export const feedsKpi = (uses: string, kpi: string) => uses.split("; ").some((u) => u.split(" · ")[1]?.split(", ").includes(kpi));
