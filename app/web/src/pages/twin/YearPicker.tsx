/**
 * The year to pick the window from, under the heat flow: the outdoor temperature on top, the heat below (the data
 * center's heat, the district's demand, what is delivered), daily means on one time axis. The window the heat flow
 * shows is a band on both; click or drag on either moves it (the other follows), the arrow keys too, and the
 * window's means stand above the charts.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type uPlot from "uplot";
import { fmt } from "../../lib/format";
import { binned } from "../../lib/period";
import { themedAxis, useUplot, type Line } from "../../ui/LineChart";
import type { ChartSeries } from "../heat/HeatCharts";
import { dateOf, meanOver, windowAt, type Window } from "../heat/window";

// canvas colours (uPlot can't read CSS vars), as the charts below
const C = { temp: "#f97316", avail: "#ef4444", data: "#94a3b8", demand: "#3b82f6", delivered: "#10b981" };
const SYNC = "twin-year"; // one cursor over both charts

interface Props {
  s: ChartSeries; // the heat per step, xs in unix seconds
  outTemp: number[]; // °C per step, the weather every part runs on
  win: Window;
  per: number; // steps per window
  onIndex: (i: number) => void;
  label: string; // the picker's accessible name, e.g. "week of the year"
  spanSec: number;
}

/** One of the two charts: its lines, the window as a band, a press or a drag picks the window under the pointer. */
function Strip({
  xs,
  lines,
  unit,
  height,
  t0,
  t1,
  onPick,
}: {
  xs: number[];
  lines: Line[];
  unit: string;
  height: number;
  t0: number;
  t1: number;
  onPick: (t: number) => void;
}) {
  const pick = useRef(onPick);
  pick.current = onPick;
  const band = useRef<[number, number]>([t0, t1]); // read by the draw hook: a new window redraws, the chart stays
  band.current = [t0, t1];
  const { el, plot } = useUplot(
    (width) =>
      xs.length
        ? {
            opts: {
              width,
              height,
              scales: { x: { time: true } },
              cursor: { sync: { key: SYNC }, drag: { x: false, y: false } },
              axes: [themedAxis(), themedAxis({ label: unit, size: 56 })],
              series: [
                { value: "{DD}.{MM}.{YYYY}" }, // daily means: the date alone
                ...lines.map((l) => ({
                  label: l.label,
                  stroke: l.color,
                  width: 1.5,
                  fill: l.fill ? l.color + "22" : undefined,
                  value: (_: uPlot, v: number | null) => (v == null ? "–" : `${fmt(v, 1)} ${unit}`),
                })),
              ],
              hooks: {
                // the window, under the lines
                drawClear: [
                  (u: uPlot) => {
                    const [t0, t1] = band.current;
                    const x0 = u.valToPos(t0, "x", true);
                    const x1 = u.valToPos(t1, "x", true);
                    const ctx = u.ctx;
                    ctx.save();
                    ctx.fillStyle = "rgba(124, 92, 255, 0.16)";
                    ctx.fillRect(x0, u.bbox.top, Math.max(2, x1 - x0), u.bbox.height);
                    ctx.strokeStyle = "rgba(124, 92, 255, 0.7)";
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(x0, u.bbox.top, Math.max(2, x1 - x0), u.bbox.height);
                    ctx.restore();
                  },
                ],
                ready: [
                  (u: uPlot) => {
                    let down = false;
                    const at = (e: PointerEvent) => pick.current(u.posToVal(e.clientX - u.over.getBoundingClientRect().left, "x"));
                    u.over.addEventListener("pointerdown", (e) => {
                      down = true;
                      u.over.setPointerCapture(e.pointerId);
                      at(e);
                    });
                    u.over.addEventListener("pointermove", (e) => down && at(e));
                    u.over.addEventListener("pointerup", () => (down = false));
                    u.over.style.cursor = "ew-resize";
                  },
                ],
              },
            },
            data: [xs, ...lines.map((l) => l.values)],
          }
        : null,
    [xs, lines, unit, height],
  );
  useEffect(() => plot.current?.redraw(false), [t0, t1, plot]);
  return <div ref={el} />;
}

export function YearPicker({ s, outTemp, win, per, onIndex, label, spanSec }: Props) {
  const { a, b, index, count } = win;
  const xs = s.xs;
  const step = xs.length > 1 ? xs[1] - xs[0] : 3600;
  const t0 = xs[a] ?? 0;
  const t1 = (xs[Math.max(a, b - 1)] ?? 0) + step;
  const temp = useMemo(() => {
    const t = binned(xs, outTemp.slice(0, xs.length));
    return { xs: t.xs, lines: [{ label: "Outdoor temperature", values: t.vs, color: C.temp }] };
  }, [xs, outTemp]);
  const heat = useMemo(() => {
    const q = binned(xs, s.q);
    return {
      xs: q.xs,
      lines: [
        { label: s.availLabel, values: q.vs, color: C.avail },
        ...(s.qData ? [{ label: "DC heat · model", values: binned(xs, s.qData).vs, color: C.data }] : []),
        { label: "District demand", values: binned(xs, s.demand).vs, color: C.demand, fill: true },
        { label: "Heat delivered", values: binned(xs, s.delivered).vs, color: C.delivered },
      ],
    };
  }, [xs, s]);
  // the window whose steps hold the time t (the last one holds the rest)
  const pickAt = (t: number) => onIndex(windowAt(t, xs[0], step, per, count));
  const key = (e: KeyboardEvent) => {
    const to = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      Home: 0,
      End: count - 1,
      PageDown: index - 4,
      PageUp: index + 4,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onIndex(Math.max(0, Math.min(count - 1, to)));
  };
  const mean = (v: number[]) => meanOver(v, a, b);
  return (
    <section className="card twin-year" aria-label="The year: pick the window">
      <div className="heat-chart-head">
        <span className="caps">The year · daily mean</span>
        <span className="heat-meta">
          {win.kind} {index + 1} · {dateOf(xs[a], spanSec)} – {dateOf(xs[b - 1], spanSec)} · outdoor {fmt(mean(outTemp), 1)} °C · DC heat {fmt(mean(s.q), 1)} kW
          · demand {fmt(mean(s.demand), 1)} kW · delivered {fmt(mean(s.delivered), 1)} kW
        </span>
      </div>
      <div
        className="twin-year__charts"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={`${win.kind} ${index + 1}, from ${dateOf(xs[a], spanSec)}`}
        onKeyDown={key}
      >
        {/* the heat first (what the heat flow above is about), the outdoor temperature that drives it under it */}
        <Strip xs={heat.xs} lines={heat.lines} unit="kW" height={190} t0={t0} t1={t1} onPick={pickAt} />
        <Strip xs={temp.xs} lines={temp.lines} unit="°C" height={130} t0={t0} t1={t1} onPick={pickAt} />
      </div>
      <p className="muted heat-meta">
        Click or drag on either chart to pick the {win.kind} the heat flow above shows (or focus the charts and use the arrow keys).
      </p>
    </section>
  );
}
