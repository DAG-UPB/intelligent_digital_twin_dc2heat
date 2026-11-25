/**
 * Compact circular causal graph (Scenarios: of the simulated model; AI modelling: of the selected graph file).
 * Click (or Enter on) a node to pick it; its downstream lights up.
 */
import { createContext, useContext, useMemo, useState } from "react";
import type { DatasetConfig } from "../../../dataset";
import { circleLayout, downstreamOf, type MapGraph } from "./causalGraph";
import "./minimap.css";

const W0 = 260; // its size on its own (Scenarios, a fixed column)
const H0 = 280;

/** The width of the panel the map sits in (GraphSidebar): the map takes it, its height following up to a limit. */
export const MapWidth = createContext<number | null>(null);
/** Width and height of the map in a panel `w` wide: wider than tall once there is room, never a tall strip. */
export const mapSize = (w: number | null): [number, number] => {
  if (!w) return [W0, H0];
  const width = Math.max(W0, w);
  return [width, Math.round(Math.min(420, Math.max(200, width * 0.72)))];
};
const NAME_ROOM = 90; // left and right of the ellipse: names like HEX_Cond_T_out (~77 px at 9 px) fit

/** dataset.json: actuators green, heat variables orange. */
const colorOf = (v: string, c: DatasetConfig | null) => (c?.actuators.includes(v) ? "var(--ok)" : c?.heat.includes(v) ? "var(--heat)" : "var(--foreground)");

const LEGEND = [
  ["var(--ok)", "actuator"],
  ["var(--heat)", "heat"],
  ["var(--foreground)", "other"],
];

/** Node colours and their legend, when not the data center's (actuator / heat / other from dataset.json). */
export interface MapPalette {
  color: (v: string) => string;
  legend: string[][]; // [colour, label]
}

/**
 * `graph`: the nodes to draw (the caller drops hidden ones: the other HEX option, calculated Q); `hint`: the line shown
 * while nothing is picked; `palette` replaces the dataset.json colours (e.g. a component's inputs and outputs);
 * `onDoubleSelect`: a double click on a node (its two clicks have reached `onSelect` before).
 */
export function CausalMiniMap({
  graph,
  config,
  selected,
  onSelect,
  hint,
  empty,
  palette,
  onDoubleSelect,
}: {
  graph: MapGraph | null;
  config: DatasetConfig | null;
  selected: string | null;
  onSelect: (v: string) => void;
  hint: string;
  empty: string;
  palette?: MapPalette;
  onDoubleSelect?: (v: string) => void;
}) {
  const [W, H] = mapSize(useContext(MapWidth));
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, pos, parents } = useMemo(() => {
    if (!graph) return { nodes: [], pos: {}, parents: {} as Record<string, string[]> };
    return { nodes: graph.nodes, pos: circleLayout(graph.nodes, W, H, NAME_ROOM), parents: graph.parents };
  }, [graph, W, H]);

  // drivers have no parents entry but are what one usually intervenes on: their downstream counts too
  const affected = useMemo(
    () => (selected && selected in pos ? new Set([...downstreamOf(parents, selected)].filter((v) => v in pos)) : new Set<string>()),
    [parents, pos, selected],
  );
  const lit = (v: string) => !selected || v === selected || affected.has(v);

  if (!graph) return <div className="minimap__empty">{empty}</div>;

  const info = hover ?? selected;
  return (
    <div className="minimap">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Causal graph">
        <defs>
          <marker id="mm-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="var(--foreground-tertiary)" />
          </marker>
        </defs>
        {nodes.flatMap((child) =>
          (parents[child] ?? []).map((p) => {
            const a = pos[p];
            const b = pos[child];
            if (!a || !b) return null;
            const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const on = !!selected && (p === selected || affected.has(p));
            return (
              <line
                key={`${p}-${child}`}
                x1={a.x + ((b.x - a.x) * 7) / d}
                y1={a.y + ((b.y - a.y) * 7) / d}
                x2={b.x - ((b.x - a.x) * 9) / d}
                y2={b.y - ((b.y - a.y) * 9) / d}
                stroke={on ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={on ? 1.6 : 1}
                opacity={selected && !on ? 0.35 : 1}
                markerEnd="url(#mm-arrow)"
              />
            );
          }),
        )}
        {nodes.map((v) => {
          const { x, y } = pos[v];
          const sel = v === selected;
          const left = x < W / 2 - 1;
          return (
            <g
              key={v}
              className="minimap__node"
              role="button"
              tabIndex={0}
              aria-label={v}
              aria-pressed={sel}
              onClick={() => onSelect(v)}
              onDoubleClick={onDoubleSelect && (() => onDoubleSelect(v))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(v);
                }
              }}
              onMouseEnter={() => setHover(v)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(v)}
              onBlur={() => setHover(null)}
              opacity={lit(v) ? 1 : 0.35}
            >
              <title>{`${v} ← ${(parents[v] ?? []).join(", ") || "input (no parents)"}`}</title>
              <circle cx={x} cy={y} r={sel ? 7 : 5} fill={palette ? palette.color(v) : colorOf(v, config)} stroke={sel || affected.has(v) ? "var(--accent)" : "var(--surface)"} strokeWidth={sel ? 3 : 2} />
              <text x={x + (left ? -9 : 9)} y={y + 3} textAnchor={left ? "end" : "start"} fontSize={9} fontWeight={sel ? 700 : 400} fill="var(--foreground-secondary)">
                {v}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="minimap__info" aria-live="polite">
        {info ? (
          <>
            <b>{info}</b> ← {(parents[info] ?? []).join(", ") || "no parents (input)"}
            {info === selected && affected.size > 0 && <> · affects {[...affected].join(", ")}</>}
          </>
        ) : (
          hint
        )}
      </div>
      <div className="minimap__legend">
        {(palette?.legend ?? LEGEND).map(([c, l]) => (
          <span key={l}>
            <i style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
