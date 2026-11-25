/**
 * What Heat Matching tells the assistant beyond its picture (ui_snapshot details): its KPIs as numbers
 * with units, the same figures as its tiles, and the part a way name means. Pure.
 */
import type { MatchResult } from "../../lib/matching";
import { co2SavedT } from "../../lib/partKpis";
import type { Part, Way } from "../heat/parts";

const r = (x: number, digits = 1) => Math.round(x * 10 ** digits) / 10 ** digits;

/** The KPI tiles of a matching run, as numbers: over the whole evaluated period. */
export function matchingKpis(T: MatchResult["totals"]) {
  return [
    { label: "Coverage", value: r(T.coveragePct), unit: "%", note: `${r(T.hoursCovered)} of ${r(T.demandHours)} h with demand fully met` },
    { label: "Heat delivered", value: r(T.deliveredMwh), unit: "MWh", note: `of ${r(T.demandMwh)} MWh demand` },
    { label: "HP electricity", value: r(T.hpElecMwh), unit: "MWh" },
    { label: "SPF", value: r(T.spf, 2), unit: "", note: "heat pump heat / electricity" },
    { label: "Unmet", value: r(T.unmetMwh), unit: "MWh", note: `DC heat used ${r(T.dcUsedPct)} %` },
    { label: "Surplus", value: r(T.surplusMwh), unit: "MWh", note: "recoverable, no taker" },
    { label: "CO₂ saved", value: r(co2SavedT(T.deliveredMwh, T.hpElecMwh)), unit: "t", note: "against gas, minus the heat pump's grid electricity" },
  ];
}

const PARTS: Part[] = ["dc", "heat", "district"];
const WAYS: Way[] = ["model", "calculation"];

/** The part and way the assistant's set_part_way names; an Error that lists the right names otherwise. */
export function partWay(part: unknown, way: unknown): { part: Part; way: Way } {
  if (!PARTS.includes(part as Part)) throw new Error(`part must be one of ${PARTS.join(", ")} (data center, heat distribution, district)`);
  if (!WAYS.includes(way as Way)) throw new Error(`way must be one of ${WAYS.join(", ")}`);
  return { part: part as Part, way: way as Way };
}
