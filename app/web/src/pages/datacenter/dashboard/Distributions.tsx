/**
 * The distribution of every variable: its histogram (the summary's 20 bins) from min to max, one small chart each.
 * A click opens it large, each bar's range and rows on hover, with the variable's statistics.
 */
import { useState } from "react";
import { useFocus } from "../shared/focus";
import type { VariableSummary } from "../../../api";
import { shownName, type Names } from "../../../lib/names";
import { fmt } from "../../../lib/format";
import { Dialog } from "../../../ui/Dialog";
import { compact } from "./dashboard";

const W = 200;
const H = 56;

function Histogram({ v, big = false }: { v: VariableSummary; big?: boolean }) {
  const { edges } = v.histogram;
  const { counts } = v.histogram;
  const top = Math.max(1, ...counts);
  const w = W / Math.max(1, counts.length);
  return (
    <svg
      className={big ? "dash-hist dash-hist--big" : "dash-hist"}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Distribution of ${v.name}, from ${compact(v.min)} to ${compact(v.max)}`}
    >
      {counts.map((c, i) => (
        <rect key={i} x={i * w} y={H - (c / top) * H} width={Math.max(1, w - 1)} height={(c / top) * H}>
          {big && <title>{`${compact(edges[i] ?? null)} … ${compact(edges[i + 1] ?? null)}: ${fmt(c)} rows`}</title>}
        </rect>
      ))}
    </svg>
  );
}

export function Distributions({ variables, names = {} }: { variables: VariableSummary[]; names?: Names }) {
  const focus = useFocus(); // picked in the graph on the left: its histogram marked
  const [open, setOpen] = useState<VariableSummary | null>(null);
  return (
    <div className="dash-dists">
      {variables.map((v) => (
        <figure
          key={v.name}
          className={focus?.v === v.name ? "dash-dist dash-dist--focus" : "dash-dist"}
          role="button"
          tabIndex={0}
          title={`${v.name}: click to open it large`}
          onClick={() => setOpen(v)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(v))}
        >
          <figcaption className="mono dash-dist__name" title={names[v.name] ? `Its own name: ${v.name}` : undefined}>
            {shownName(v.name, names)}
          </figcaption>
          <Histogram v={v} />
          <div className="mono muted dash-dist__range">
            <span>{compact(v.min)}</span>
            <span>{compact(v.max)}</span>
          </div>
        </figure>
      ))}
      {open && <Large v={open} name={shownName(open.name, names)} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One variable's histogram, large: hover a bar for its range and rows; its statistics under it. */
function Large({ v, name, onClose }: { v: VariableSummary; name: string; onClose: () => void }) {
  const stats: [string, number | null][] = [
    ["rows", v.count],
    ["missing", v.missing],
    ["mean", v.mean],
    ["std", v.std],
    ["min", v.min],
    ["25 %", v.p25],
    ["median", v.median],
    ["75 %", v.p75],
    ["max", v.max],
  ];
  return (
    <Dialog label={`Distribution of ${v.name}`} onClose={onClose}>
      <h2 className="mono">{name}</h2>
      <Histogram v={v} big />
      <div className="mono muted dash-dist__range">
        <span>{compact(v.min)}</span>
        <span>{compact(v.max)}</span>
      </div>
      <dl className="dash-dist__stats">
        {stats.map(([k, x]) => (
          <div key={k}>
            <dt className="caps">{k}</dt>
            <dd className="mono">{compact(x)}</dd>
          </div>
        ))}
      </dl>
      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
