/**
 * Pearson correlation of every pair of variables as a heatmap (-1 blue, 0 grey, +1 red), in data order or with similar
 * variables next to each other, and the scatter of one pair (click a cell, or pick the two variables).
 */
import { useOnFocus } from "../shared/focus";
import { useMemo } from "react";
import { useKept } from "../../../lib/kept";
import type { DatasetSummary } from "../../../api";
import { fmt } from "../../../lib/format";
import { Field } from "../../../ui/Field";
import { Segmented } from "../../../ui/Segmented";
import { compact, corrFill, corrInk, similarityOrder } from "./dashboard";

const CHAR = 6.4; // px per character of an 11px label (estimate for the margins)
const VALUE_CELL = 30; // px: cells at least this big print their r (smaller below 36)
const SLANT_CELL = 28; // px: smaller cells get vertical top labels (slanted ones would overlap)
const SIZE = 460; // px: the heatmap at most, labels included; the scatter beside it gets the same size, both scale down in a narrow column

function Scatter({ summary, x, y, W, H }: { summary: DatasetSummary; x: string; y: string; W: number; H: number }) {
  const P = 52; // left margin: y tick labels and the rotated y name
  const xs = summary.series.columns[x];
  const ys = summary.series.columns[y];
  const pts = xs.flatMap((a, i) => (a != null && ys[i] != null ? [[a, ys[i] as number]] : []));
  if (!pts.length) return <p className="muted dash__note">No rows where both have a value.</p>;
  const range = (k: 0 | 1) => {
    const v = pts.map((p) => p[k]);
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return [lo, hi > lo ? hi : lo + 1];
  };
  const [x0, x1] = range(0);
  const [y0, y1] = range(1);
  const sx = (v: number) => P + ((v - x0) / (x1 - x0)) * (W - P - 8);
  const sy = (v: number) => H - P + 8 - ((v - y0) / (y1 - y0)) * (H - P);
  const n = summary.correlation.names;
  const r = summary.correlation.matrix[n.indexOf(x)]?.[n.indexOf(y)];
  return (
    <svg className="dash-scatter" width={W} height={H + 8} viewBox={`0 0 ${W} ${H + 8}`} role="img" aria-label={`Scatter of ${y} against ${x}, r = ${compact(r)}`}>
      <line className="dash-scatter__axis" x1={P} y1={H - P + 8} x2={W - 8} y2={H - P + 8} />
      <line className="dash-scatter__axis" x1={P} y1={8} x2={P} y2={H - P + 8} />
      {pts.map(([a, b], i) => (
        <circle key={i} cx={sx(a)} cy={sy(b)} r={2.5} />
      ))}
      <text x={P} y={H - P + 22}>{compact(x0)}</text>
      <text x={W - 8} y={H - P + 22} textAnchor="end">{compact(x1)}</text>
      <text x={P - 4} y={H - P + 8} textAnchor="end">{compact(y0)}</text>
      <text x={P - 4} y={14} textAnchor="end">{compact(y1)}</text>
      <text x={(W + P) / 2} y={H + 4} textAnchor="middle" className="dash-scatter__name">{x}</text>
      <text transform={`translate(12 ${(H - P) / 2 + 8}) rotate(-90)`} textAnchor="middle" className="dash-scatter__name">{y}</text>
    </svg>
  );
}

export function CorrelationMatrix({ summary }: { summary: DatasetSummary }) {
  const { names, matrix } = summary.correlation;
  const [mode, setMode] = useKept<"data" | "similar">(`corr-mode|${summary.file}`, "data");
  const [chosen, setPair] = useKept<[string, string]>(`corr-chosen|${summary.file}`, [names[0], names[1] ?? names[0]]);
  // the variables can change under it (another file, a part's variables arriving): a pair no longer there falls back
  const pair: [string, string] = names.includes(chosen[0]) && names.includes(chosen[1]) ? chosen : [names[0], names[1] ?? names[0]];
  // picked in the graph on the left: the first of the pair shown
  useOnFocus((v) => names.includes(v) && setPair(([, b]) => [v, b === v ? (names.find((x) => x !== v) ?? v) : b]));
  const order = useMemo(() => (mode === "data" ? names.map((_, i) => i) : similarityOrder(matrix)), [mode, names, matrix]);

  const n = order.length;
  const label = Math.max(0, ...names.map((s) => s.length)) * CHAR + 8;
  // the cells share what the labels leave of SIZE: slanted top labels take more width, vertical ones more height
  const fit = (labels: number) => Math.floor((SIZE - labels) / Math.max(1, n));
  const cell = Math.max(14, Math.min(44, fit(label * 1.71) >= SLANT_CELL ? fit(label * 1.71) : Math.min(SLANT_CELL - 1, fit(label + 8))));
  const slant = cell >= SLANT_CELL ? 45 : 90; // degrees the top labels are turned
  const rise = slant === 45 ? 0.71 : 1; // sin of it: height of a turned label per px of its length
  const top = label * rise + 8;
  const W = label + n * cell + (slant === 45 ? label * 0.71 : 0);
  const H = top + n * cell;
  const values = cell >= VALUE_CELL;
  // the scatter as big as the heatmap (within limits for very few or very many variables)
  const sw = Math.min(SIZE, Math.max(300, Math.round(W)));
  const sh = Math.min(SIZE, Math.max(240, Math.round(H)));

  return (
    <div className="dash-corr">
      <div className="dash-corr__tools">
        <Segmented
          label="Order of the variables"
          value={mode}
          onChange={setMode}
          options={[
            { id: "data", label: "Data order" },
            { id: "similar", label: "Similar together" },
          ]}
        />
        <span className="dash-corr__legend" aria-hidden>
          <span className="mono">−1</span>
          <span className="dash-corr__ramp" />
          <span className="mono">+1</span>
        </span>
        <span className="muted">Pairs of rows where both have a value; grey cross: a constant variable (no correlation).</span>
      </div>
      <div className="dash-corr__body">
        <div className="dash-corr__scroll">
          <svg className="dash-corr__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Correlation matrix of ${n} variables; hover a cell for its value, click it for the scatter`}>
            {order.map((i, k) => (
              <g key={i}>
                <text x={label - 6} y={top + k * cell + cell / 2} textAnchor="end" dominantBaseline="central">{names[i]}</text>
                <text x={label + k * cell + cell / 2} y={top - 6} dominantBaseline={slant === 90 ? "central" : undefined} transform={`rotate(-${slant} ${label + k * cell + cell / 2} ${top - 6})`}>{names[i]}</text>
              </g>
            ))}
            {order.map((i, row) =>
              order.map((j, col) => {
                const r = matrix[i][j];
                const on = pair[0] === names[j] && pair[1] === names[i];
                return (
                  <g key={`${i}-${j}`} className="dash-corr__cell" onClick={() => setPair([names[j], names[i]])}>
                    <rect x={label + col * cell} y={top + row * cell} width={cell - 1} height={cell - 1} rx={2} style={{ fill: corrFill(r) }} className={on ? "dash-corr__on" : undefined}>
                      <title>{`${names[i]} × ${names[j]}: r = ${r == null ? "none (constant)" : fmt(r, 3)}`}</title>
                    </rect>
                    {r == null && <path className="dash-corr__none" d={`M${label + col * cell + 4} ${top + row * cell + 4}l${cell - 9} ${cell - 9}`} />}
                    {values && r != null && (
                      <text x={label + col * cell + cell / 2} y={top + row * cell + cell / 2} textAnchor="middle" dominantBaseline="central" style={{ fill: corrInk(r) }} className={cell < 36 ? "dash-corr__value dash-corr__value--sm" : "dash-corr__value"}>
                        {fmt(r, 2) /* fmt: no "-0,00" */}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        </div>
        <div className="dash-corr__pair">
          <div className="dash-corr__selects">
            <Field label="X">
              <select className="field field--sm" value={pair[0]} onChange={(e) => setPair([e.target.value, pair[1]])}>
                {names.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Y">
              <select className="field field--sm" value={pair[1]} onChange={(e) => setPair([pair[0], e.target.value])}>
                {names.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
          </div>
          {names.length > 0 && <Scatter summary={summary} x={pair[0]} y={pair[1]} W={sw} H={sh - 8} />}
          <p className="muted dash__note">
            {pair[1]} against {pair[0]}: r = {compact(matrix[names.indexOf(pair[1])]?.[names.indexOf(pair[0])])} over all rows; the dots are the {summary.series.time.length} bin means of the time series.
          </p>
        </div>
      </div>
    </div>
  );
}
