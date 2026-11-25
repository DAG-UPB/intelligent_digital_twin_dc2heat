/** One setpoint change up close: the actual variable and each structure's best model, free running through the change. */
import { useMemo, useState } from "react";
import type { EvaluateResponse } from "../../../api";
import { STRUCTS, TAG } from "../../../lib/modelCatalog";
import LineChart, { type Line } from "../../../ui/LineChart";
import { Field } from "../../../ui/Field";
import { pct } from "./format";
import type { VariableRanking } from "./ranking";

const ACTUAL = "#8391a7"; // chart line (canvas: no CSS vars)

export function SetpointEventCard({ events, predicted, ranking }: { events: EvaluateResponse["events"]; predicted: string[]; ranking: Record<string, VariableRanking> }) {
  const [eventIdx, setEventIdx] = useState(0);
  const [shownFor, setShownFor] = useState(events);
  if (shownFor !== events) {
    // a new evaluation: back to its first event
    setShownFor(events);
    setEventIdx(0);
  }
  const [plotPick, setPlotPick] = useState("");
  const plotVar = predicted.includes(plotPick) ? plotPick : (predicted[0] ?? "");
  const ev = events[eventIdx] ?? events[0];
  const best = ranking[plotVar]?.best;

  const chart = useMemo(() => {
    if (!ev?.actual[plotVar] || !best) return null;
    const xs = ev.time.map((t) => new Date(t).getTime() / 1000);
    const lines: Line[] = [{ label: "Actual", values: ev.actual[plotVar], color: ACTUAL }];
    for (const st of STRUCTS) {
      const b = best[st.id];
      const values = b && ev.pred[b.def.name]?.[plotVar];
      if (b && values) lines.push({ label: b.def.label, values, color: b.def.color });
    }
    return { xs, lines };
  }, [ev, plotVar, best]);

  return (
    <div className="card">
      <div className="train-event__head">
        <Field label="Setpoint change">
          <select className="field" value={eventIdx} onChange={(e) => setEventIdx(Number(e.target.value))}>
            {events.map((e, i) => (
              <option key={`${e.lever}@${e.start}`} value={i}>
                {e.time[0]?.slice(0, 16).replace("T", " ")} · {e.lever} {e.from} → {e.to}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Variable">
          <select className="field" value={plotVar} onChange={(e) => setPlotPick(e.target.value)}>
            {predicted.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        {ev && best && (
          <span className="muted train-event__score">
            This week:{" "}
            {STRUCTS.map((st) => {
              const b = best[st.id];
              return b ? `${st.label} (${TAG[b.def.kind].text}) ${pct(ev.nmae[b.def.name]?.[plotVar])}` : null;
            })
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </div>
      {chart && <LineChart xs={chart.xs} lines={chart.lines} height={260} unit="" />}
    </div>
  );
}
