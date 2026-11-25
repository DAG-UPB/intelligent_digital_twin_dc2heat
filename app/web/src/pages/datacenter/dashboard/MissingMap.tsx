/** Where in time each variable is missing: one row per variable, the share missing per time bin (summary "missing_map"). */
import { useState } from "react";
import type { DatasetSummary } from "../../../api";
import { Switch } from "../../../ui/Switch";

export function MissingMap({ summary }: { summary: DatasetSummary }) {
  const [all, setAll] = useState(false);
  const rows = summary.variables.filter((v) => all || v.missing > 0).map((v) => v.name);
  const bins = summary.series.time.length;
  const W = 900;
  const LEFT = 160;
  const ROW = 14;
  const cell = (W - LEFT) / Math.max(bins, 1);
  return (
    <div className="dash-missing">
      <Switch checked={all} onChange={setAll} label="Show complete variables too" />
      {!rows.length ? (
        <p className="muted dash__note">No variable has missing values in this file.</p>
      ) : (
        <svg className="dash-missing__svg" viewBox={`0 0 ${W} ${rows.length * ROW + 20}`} role="img" aria-label="Missing values over time, by variable">
          {rows.map((n, r) => (
            <g key={n}>
              <text x={LEFT - 6} y={r * ROW + 11} className="dash-profile__label" textAnchor="end">
                {n.length > 24 ? `${n.slice(0, 23)}…` : n}
              </text>
              <rect x={LEFT} y={r * ROW + 1} width={W - LEFT} height={ROW - 2} fill="var(--surface-2)" />
              {(summary.missing_map[n] ?? []).map((share, i) =>
                share > 0 ? (
                  <rect key={i} x={LEFT + i * cell} y={r * ROW + 1} width={Math.max(cell, 1)} height={ROW - 2} fill={`color-mix(in srgb, var(--danger) ${Math.round(25 + 75 * share)}%, transparent)`}>
                    <title>{`${n} · ${summary.series.time[i]?.replace("T", " ")} · ${Math.round(share * 100)} % missing`}</title>
                  </rect>
                ) : null,
              )}
            </g>
          ))}
          <text x={LEFT} y={rows.length * ROW + 16} className="dash-profile__label">
            {summary.start?.replace("T", " ")}
          </text>
          <text x={W} y={rows.length * ROW + 16} className="dash-profile__label" textAnchor="end">
            {summary.end?.replace("T", " ")}
          </text>
        </svg>
      )}
      <p className="muted dash__note">Red where values are missing (darker: more of that stretch). Fill them with a recommendation, or with Prepare variables › Fill gaps.</p>
    </div>
  );
}
