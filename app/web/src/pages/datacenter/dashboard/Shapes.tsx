/**
 * More views of one variable at a time (backend summary "duration", "daily", "acf", "monthly"): the load duration
 * curve, the daily profile with its 10-90 % band, the autocorrelation (how many steps back it still follows its own
 * past: a hint for the lags of the causal graph) and every variable's monthly means as a heatmap.
 */
import { useFocus, useOnFocus } from "../shared/focus";
import { useMemo, useState } from "react";
import type { DatasetSummary } from "../../../api";
import { Field } from "../../../ui/Field";
import { themedAxis, useUplot } from "../../../ui/LineChart";
import { compact, defaultShown } from "./dashboard";
import { CellValue, tint } from "./ProfileHeatmap";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function useVariable(summary: DatasetSummary) {
  const names = summary.variables.filter((v) => (v.std ?? 0) > 0).map((v) => v.name);
  const [name, setName] = useState(() => defaultShown(summary.variables, 1)[0] ?? names[0]);
  useOnFocus((v) => names.includes(v) && setName(v)); // picked in the graph on the left
  const picker = (
    <Field label="Variable">
      <select className="field field--sm" value={name} onChange={(e) => setName(e.target.value)}>
        {names.map((n) => (
          <option key={n}>{n}</option>
        ))}
      </select>
    </Field>
  );
  return [name, picker] as const;
}

function XYChart({ xs, series, xLabel, label, band }: { xs: number[]; series: { label: string; values: (number | null)[]; color: string }[]; xLabel: string; label: string; band?: boolean }) {
  const { el } = useUplot(
    (width) => ({
      opts: {
        width,
        height: 220,
        scales: { x: { time: false } },
        legend: { show: true },
        axes: [themedAxis({ label: xLabel }), themedAxis({ size: 60, values: (_u, t) => t.map((x) => compact(x)) })],
        series: [{ label: xLabel }, ...series.map((s, i) => ({ label: s.label, stroke: s.color, width: band && i !== 1 ? 1 : 2, dash: band && i !== 1 ? [4, 4] : undefined, value: (_u: unknown, x: number) => compact(x) }))],
        ...(band ? { bands: [{ series: [1, 3] as [number, number], fill: `color-mix(in srgb, ${css("--accent")} 15%, transparent)` }] } : {}),
      },
      data: [xs, ...series.map((s) => s.values as number[])],
    }),
    [xs, series, band],
  );
  return <div ref={el} className="dash-series__chart" role="img" aria-label={label} />;
}

export function DailyProfile({ summary }: { summary: DatasetSummary }) {
  const [name, picker] = useVariable(summary);
  const d = summary.daily[name];
  const xs = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);
  const series = useMemo(
    () => (d ? [
      { label: "90 %", values: d.p90, color: css("--accent") },
      { label: "mean", values: d.mean, color: css("--accent") },
      { label: "10 %", values: d.p10, color: css("--accent") },
    ] : []),
    [d],
  );
  return (
    <div className="dash-profile">
      <div className="dash-corr__tools">{picker}</div>
      {d ? <XYChart xs={xs} series={series} xLabel="hour of day" label={`Daily profile of ${name}`} band /> : <p className="muted dash__note">No time column.</p>}
      <p className="muted dash__note">The typical day of {name}: its mean by hour, and the band in which 80 % of the days lie.</p>
    </div>
  );
}

export function Autocorrelation({ summary }: { summary: DatasetSummary }) {
  const [name, picker] = useVariable(summary);
  const acf = summary.acf[name] ?? [];
  const step = summary.resolution_seconds ? summary.resolution_seconds / 3600 : null;
  const W = 900;
  const H = 200;
  const bar = (W - 40) / Math.max(acf.length, 1);
  const y = (r: number) => H / 2 - (r * (H / 2 - 10));
  const sig = 2 / Math.sqrt(Math.max(summary.rows, 1)); // above this it is more than noise
  return (
    <div className="dash-profile">
      <div className="dash-corr__tools">{picker}</div>
      <svg className="dash-profile__svg" viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label={`Autocorrelation of ${name}`}>
        <line x1={40} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" />
        {[sig, -sig].map((s) => (
          <line key={s} x1={40} x2={W} y1={y(s)} y2={y(s)} stroke="var(--border-strong)" strokeDasharray="4 4" />
        ))}
        {[1, 0.5, -0.5, -1].map((t) => (
          <text key={t} x={34} y={y(t) + 4} className="dash-profile__label" textAnchor="end">
            {t}
          </text>
        ))}
        {acf.map((r, i) =>
          r == null ? null : (
            <rect key={i} x={40 + i * bar + 1} width={Math.max(bar - 2, 1)} y={Math.min(y(r), y(0))} height={Math.abs(y(r) - y(0))} fill={r >= 0 ? "var(--accent)" : "var(--heat-strong)"}>
              <title>{`${i + 1} step${i ? "s" : ""} back${step ? ` (${compact((i + 1) * step)} h)` : ""}: r = ${compact(r)}`}</title>
            </rect>
          ),
        )}
        {acf.map((_, i) =>
          (i + 1) % 6 === 0 ? (
            <text key={i} x={40 + i * bar + bar / 2} y={H + 14} className="dash-profile__label" textAnchor="middle">
              {i + 1}
            </text>
          ) : null,
        )}
      </svg>
      <p className="muted dash__note">
        How much {name} resembles itself 1, 2, … steps back{step ? ` (one step = ${compact(step)} h)` : ""}. Bars beyond the dashed lines are more than noise: a peak at 24 steps of hourly data is the daily rhythm; a slow decline is
        inertia. A hint for the own-past lags (↻) in the causal graph.
      </p>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthlyHeatmap({ summary }: { summary: DatasetSummary }) {
  const names = summary.variables.filter((v) => (v.std ?? 0) > 0).map((v) => v.name);
  const focus = useFocus(); // picked in the graph on the left: its row marked
  const CELL = 44;
  const ROW = 18;
  const LEFT = 170;
  return (
    <div className="dash-profile">
      <svg className="dash-profile__svg" viewBox={`0 0 ${LEFT + 12 * CELL} ${names.length * ROW + 20}`} role="img" aria-label="Monthly means of every variable">
        {MONTHS.map((m, i) => (
          <text key={m} x={LEFT + i * CELL + CELL / 2} y={12} className="dash-profile__label" textAnchor="middle">
            {m}
          </text>
        ))}
        {names.map((n, r) => {
          const row = summary.monthly[n] ?? [];
          const vals = row.filter((v): v is number => v != null);
          const [lo, hi] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
          return (
            <g key={n}>
              <text x={LEFT - 6} y={20 + r * ROW + 12} className={`dash-profile__label${focus?.v === n ? " dash-profile__label--focus" : ""}`} textAnchor="end">
                {n.length > 24 ? `${n.slice(0, 23)}…` : n}
              </text>
              {row.map((v, i) => (
                <g key={i}>
                  <rect x={LEFT + i * CELL} y={20 + r * ROW} width={CELL - 2} height={ROW - 2} rx={2} fill={tint(v, lo, hi)}>
                    <title>{`${n} · ${MONTHS[i]} · ${v == null ? "no data" : compact(v)}`}</title>
                  </rect>
                  <CellValue x={LEFT + i * CELL + (CELL - 2) / 2} y={20 + r * ROW + (ROW - 2) / 2} v={v} lo={lo} hi={hi} size={8.5} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      <p className="muted dash__note">Each variable's monthly mean, from its lowest month (light) to its highest (dark): the seasons at a glance. Grey: no data in that month.</p>
    </div>
  );
}
