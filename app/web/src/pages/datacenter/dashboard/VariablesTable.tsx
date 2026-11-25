/** Descriptive statistics of every variable, sortable by any column, with its role and the groups it is marked in (on
 * the Physical structure page); the histograms are in Distributions. */
import { useFocus } from "../shared/focus";
import { useState } from "react";
import type { VariableSummary } from "../../../api";
import { fmt, fmtUpTo } from "../../../lib/format";
import { shownName, type Names } from "../../../lib/names";
import { compact, sortVariables, type SortKey } from "./dashboard";

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: "name", label: "Variable", title: "Column name and its role from dataset.json" },
  { key: "count", label: "Count", title: "Values present" },
  { key: "missing", label: "Missing", title: "Share of rows without a value" },
  { key: "mean", label: "Mean", title: "Mean" },
  { key: "std", label: "Std", title: "Standard deviation" },
  { key: "min", label: "Min", title: "Minimum" },
  { key: "p25", label: "P25", title: "25th percentile" },
  { key: "median", label: "Median", title: "Median" },
  { key: "p75", label: "P75", title: "75th percentile" },
  { key: "max", label: "Max", title: "Maximum" },
];

export function VariablesTable({
  variables,
  rows,
  groups = {},
  names = {},
}: {
  variables: VariableSummary[];
  rows: number;
  groups?: Record<string, string[]>;
  names?: Names; // the names shown in place of the variables' own (Physical structure)
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const focus = useFocus(); // picked in the graph on the left: its row marked
  const shown = sort ? sortVariables(variables, sort.key, sort.dir) : variables;
  const by = (key: SortKey) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <div className="dash-table__wrap">
      <table className="dash-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                <button type="button" className="dash-table__sort" title={`${c.title}; click to sort`} onClick={() => by(c.key)}>
                  {c.label}
                  <span aria-hidden>{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.name} className={focus?.v === v.name ? "dash-table__row--focus" : undefined}>
              <th scope="row">
                <span className="dash-table__name mono" title={names[v.name] ? `Its own name: ${v.name}` : undefined}>
                  {shownName(v.name, names)}
                </span>
                {names[v.name] && <span className="dash-table__own mono">{v.name}</span>}
                {v.role !== "measured" && <span className={`pill pill--sm dash-role dash-role--${v.role}`}>{v.role}</span>}
                {v.prepared && (
                  <span className="pill pill--sm dash-role dash-role--prepared" title="Prepared on this Dashboard: kept next to the data, which is not changed">
                    prepared
                  </span>
                )}
                {(groups[v.name] ?? []).map((g) => (
                  <span
                    key={g}
                    className="pill pill--sm dash-role dash-role--group"
                    title={`Marked as a member of the group ${g} (Physical structure); its values are not changed`}
                  >
                    in {g}
                  </span>
                ))}
                {v.calculated && (
                  <span className="pill pill--sm dash-role" title="Calculated from its heat exchanger's m, T_in and T_out: Q = ṁ·cₚ·(T_in − T_out); not a model target">
                    calculated
                  </span>
                )}
              </th>
              <td className="mono">{fmt(v.count)}</td>
              <td className="mono">{rows ? `${fmtUpTo((v.missing / rows) * 100, 1)} %` : "–"}</td>
              {(["mean", "std", "min", "p25", "median", "p75", "max"] as const).map((k) => (
                <td key={k} className="mono" title={v[k] == null ? undefined : String(v[k])}>
                  {compact(v[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
