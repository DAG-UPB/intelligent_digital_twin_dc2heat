/**
 * Heat Matching's chart: the window at full resolution with the recovery paths and a window picker.
 */
import { useMemo } from "react";
import type { MatchResult } from "../../lib/matching";
import { durationLabel } from "../../lib/period";
import LineChart, { type Line } from "../../ui/LineChart";
import { dateOf, type Window } from "./window";

// Canvas line colors (uPlot can't read CSS vars); mid-tones readable on light and dark.
const C = { avail: "#ef4444", data: "#94a3b8", demand: "#3b82f6", delivered: "#10b981", tank: "#06b6d4", hp: "#a855f7", direct: "#f59e0b" };

/** What both charts draw: the source heat (scaled), the data for comparison, the demand and what was delivered, per step. */
export interface ChartSeries {
  xs: number[]; // unix seconds
  q: number[];
  qData: number[] | null; // the Model's heat next to the calculated source
  demand: number[];
  delivered: number[];
  availLabel: string;
}

const TITLE = { period: "Whole test period", week: "Week", day: "Day" };

export function WindowChart({ s, res, win, stepHours, spanSec, onIndex }: { s: ChartSeries | null; res: MatchResult | null; win: Window; stepHours: number; spanSec: number; onIndex: (i: number) => void }) {
  const { a, b, kind, index, count } = win;
  const chart = useMemo(() => {
    if (!s || !res) return null;
    const lines: Line[] = [
      { label: s.availLabel, values: s.q.slice(a, b), color: C.avail },
      ...(s.qData ? [{ label: "DC heat · model", values: s.qData.slice(a, b), color: C.data }] : []),
      { label: "District demand", values: s.demand.slice(a, b), color: C.demand, fill: true },
      { label: "Heat delivered", values: s.delivered.slice(a, b), color: C.delivered },
      { label: "Direct HEX", values: res.direct.slice(a, b), color: C.direct },
      { label: "Heat pump", values: res.hp.slice(a, b), color: C.hp },
      { label: "From tank", values: res.fromTank.slice(a, b), color: C.tank },
    ];
    return { xs: s.xs.slice(a, b), lines };
  }, [s, res, a, b]);
  return (
    <div className="card">
      <div className="heat-chart-head heat-chart-head--center">
        <span className="caps">
          {TITLE[kind]} · every {durationLabel(stepHours * 3600)}
        </span>
        {count > 1 && (
          <div className="heat-winnav">
            <button type="button" className="btn btn--icon" onClick={() => onIndex(Math.max(0, index - 1))} aria-label={`Previous ${kind}`}>
              ‹
            </button>
            <input type="range" min={0} max={count - 1} value={index} onChange={(e) => onIndex(Number(e.target.value))} aria-label={kind} />
            <button type="button" className="btn btn--icon" onClick={() => onIndex(Math.min(count - 1, index + 1))} aria-label={`Next ${kind}`}>
              ›
            </button>
            <span className="mono heat-winnav__label">
              {kind === "week" ? "W" : "D"}
              {index + 1} · {dateOf(s?.xs[a], spanSec)}
            </span>
          </div>
        )}
      </div>
      {chart && <LineChart xs={chart.xs} lines={chart.lines} height={260} />}
    </div>
  );
}
