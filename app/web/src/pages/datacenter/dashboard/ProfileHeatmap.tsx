/** The weekly rhythm of one variable: its mean by weekday and hour (7 x 24), as a heatmap (backend summary "profile"). */
import { useOnFocus } from "../shared/focus";
import { useState } from "react";
import type { DatasetSummary } from "../../../api";
import { Field } from "../../../ui/Field";
import { compact, defaultShown } from "./dashboard";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL = 26;
const LEFT = 40;
const TOP = 18;

/** Share of the way from lo to hi, as an accent tint (0: surface, 1: full accent). */
export const tint = (v: number | null, lo: number, hi: number) =>
  v == null ? "var(--surface-2)" : `color-mix(in srgb, var(--accent) ${Math.round(8 + 92 * (hi > lo ? (v - lo) / (hi - lo) : 0.5))}%, var(--surface))`;

/** A cell's value written on it: three digits at most (25.6, 0.42, 2356), light on the dark cells. */
export function CellValue({ x, y, v, lo, hi, size }: { x: number; y: number; v: number | null; lo: number; hi: number; size: number }) {
  if (v == null) return null;
  const dark = hi > lo && (v - lo) / (hi - lo) > 0.55;
  return (
    <text x={x} y={y + size * 0.36} textAnchor="middle" className="dash-profile__value" fontSize={size} fill={dark ? "#fff" : "var(--foreground)"}>
      {Math.abs(v) >= 1000 ? Math.round(v) : Number(v.toPrecision(3))}
    </text>
  );
}

export function ProfileHeatmap({ summary }: { summary: DatasetSummary }) {
  const names = summary.variables.filter((v) => (v.std ?? 0) > 0).map((v) => v.name);
  const [name, setName] = useState(() => defaultShown(summary.variables, 1)[0] ?? names[0]);
  useOnFocus((v) => names.includes(v) && setName(v)); // picked in the graph on the left
  const grid = (name && summary.profile?.[name]) || null;
  const values = (grid ?? []).flat().filter((v): v is number => v != null);
  const [lo, hi] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
  return (
    <div className="dash-profile">
      <div className="dash-corr__tools">
        <Field label="Variable">
          <select className="field field--sm" value={name} onChange={(e) => setName(e.target.value)}>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <span className="dash-corr__legend">
          {compact(lo)} <span className="dash-profile__ramp" /> {compact(hi)}
        </span>
      </div>
      {!grid ? (
        <p className="muted dash__note">No time column: no weekly profile.</p>
      ) : (
        <svg className="dash-profile__svg" viewBox={`0 0 ${LEFT + 24 * CELL} ${TOP + 7 * CELL}`} role="img" aria-label={`${name}: mean by weekday and hour`}>
          {Array.from({ length: 24 }, (_, h) => (
            <text key={h} x={LEFT + h * CELL + CELL / 2} y={12} className="dash-profile__label" textAnchor="middle">
              {h % 3 === 0 ? h : ""}
            </text>
          ))}
          {grid.map((row, d) => (
            <g key={d}>
              <text x={LEFT - 6} y={TOP + d * CELL + CELL / 2 + 4} className="dash-profile__label" textAnchor="end">
                {DAYS[d]}
              </text>
              {row.map((v, h) => (
                <g key={h}>
                  <rect x={LEFT + h * CELL} y={TOP + d * CELL} width={CELL - 2} height={CELL - 2} rx={3} fill={tint(v, lo, hi)}>
                    <title>{`${DAYS[d]} ${h}:00 · ${compact(v)}`}</title>
                  </rect>
                  <CellValue x={LEFT + h * CELL + (CELL - 2) / 2} y={TOP + d * CELL + (CELL - 2) / 2} v={v} lo={lo} hi={hi} size={7} />
                </g>
              ))}
            </g>
          ))}
        </svg>
      )}
      <p className="muted dash__note">Mean of {name} for each hour of each weekday over the whole file: a rhythm by day and by hour shows the load pattern.</p>
    </div>
  );
}
