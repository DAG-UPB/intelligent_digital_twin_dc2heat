/**
 * A structure's connection points beside a P&ID picture or an empty structure (connection.ts), in the margin on each
 * side that has one: the neighbour's box, as the built-in drawings have it, and the supply (red) and the return
 * (blue) between it and the picture's edge, at the connection point's heights. The weather's box (WeatherBox) is on
 * every structure, built-in drawing or not.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import type { StructureScope } from "../../../api";
import { STYLE } from "./DrawnEquipment";
import { boundary, EDGE_X, MARGIN, neighbourX, portY, SIDES, SURFACE_MAX, weatherBox, type StripVar } from "./connection";
import { H } from "./geometry";
import type { Pos } from "./layout";

const { label, small } = STYLE;

/** The weather's box, on every structure: above the neighbour's box (connection.ts weatherBox), `n` slots wide. */
export function WeatherBox({ scope, drawn, n, opacity = 1 }: { scope: StructureScope; drawn: boolean; n: number; opacity?: number }) {
  const [wx, ww] = weatherBox(scope, drawn, n);
  return (
    <g pointerEvents="none" opacity={opacity}>
      <rect x={wx} y={4} width={ww} height={100} rx={8} fill="var(--surface-2)" stroke="var(--foreground-tertiary)" strokeDasharray="6 4" />
      <text x={wx + 8} y={20} style={label}>
        Weather
      </text>
    </g>
  );
}

/** An empty structure's data center (connection.ts boundary): the box to draw in, the whole surface `sh` high but a
 * band on top, and across its top border an arrow at each input (into it) and output (out of it) above it, wherever it
 * is. Its bottom edge's handle makes the surface taller or shorter (by drag or the arrow keys). */
export function DcBoundary(props: {
  vars: StripVar[];
  pos: Pos;
  h: number;
  onResize: (h: number, done: boolean) => void;
  opacity?: number;
  name?: string; // the part the box is: the data center, or the heat distribution or the district in the new form
}) {
  const { vars, pos, opacity = 1, onResize, name = "Data center" } = props;
  const [x, y, w, h] = boundary(props.h);
  const height = (to: number) => Math.round(Math.min(SURFACE_MAX, Math.max(H, to)) / 10) * 10;
  const at = (e: ReactPointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement!;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse()).y + 2;
  };
  return (
    <g pointerEvents="none" opacity={opacity} aria-label={name}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke="var(--foreground-tertiary)" strokeWidth={1.5} strokeDasharray="8 5" />
      <text x={x + 12} y={y + 22} style={label}>
        {name}
      </text>
      {vars.map((s) => {
        const p = pos[s.v];
        if (!p || p.y > y) return null; // moved into the box: no arrow
        const [a, b] = s.io === "input" ? [y + 2, y + 24] : [y + 24, y + 2]; // from the border into the box: its name sits just above
        return <path key={s.v} d={`M${p.x},${a} V${b}`} stroke="var(--foreground-secondary)" strokeWidth={1.5} markerEnd="url(#flow-io)" />;
      })}
      <rect
        x={x + w / 2 - 40}
        y={y + h - 6}
        width={80}
        height={12}
        rx={6}
        fill="var(--foreground-tertiary)"
        opacity={0.6}
        pointerEvents="all"
        style={{ cursor: "ns-resize" }}
        role="slider"
        tabIndex={0}
        aria-label="Surface height"
        aria-valuenow={props.h}
        aria-valuemin={H}
        aria-valuemax={SURFACE_MAX}
        onPointerDown={(e) => {
          e.stopPropagation(); // not a pan of the drawing
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onResize(height(at(e)), false)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onResize(height(at(e)), true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          onResize(height(props.h + (e.key === "ArrowDown" ? 80 : -80)), true);
        }}
      >
        <title>Drag to make the surface taller or shorter</title>
      </rect>
    </g>
  );
}

export function ConnectionPoints({ scope, h, margin = MARGIN, opacity = 1 }: { scope: StructureScope; h: number; margin?: number; opacity?: number }) {
  const [s, r] = portY(h);
  return (
    <g pointerEvents="none" opacity={opacity} aria-label="Connection points">
      {SIDES[scope].map(({ side, neighbour }) => {
        const [bx, bw] = neighbourX(side, margin);
        const edge = side === "out" ? bx : bx + bw; // the box's side facing the part
        const inner = EDGE_X[side]; // the picture's edge
        // the supply flows towards the district: out of the part on its out side, into it on its in side
        const supply = side === "out" ? `M${inner},${s} H${edge}` : `M${edge},${s} H${inner}`;
        const ret = side === "out" ? `M${edge},${r} H${inner}` : `M${inner},${r} H${edge}`;
        return (
          <g key={side}>
            <rect
              x={bx}
              y={s - 60}
              width={bw}
              height={r - s + 120}
              rx={8}
              fill="var(--surface-2)"
              stroke="var(--foreground-tertiary)"
              strokeDasharray="6 4"
              opacity={0.9}
            />
            {neighbour.split(" ").map((word, i) => (
              <text key={word} x={bx + bw / 2} y={s - 40 + i * 15} textAnchor="middle" style={label}>
                {word}
              </text>
            ))}
            <text x={bx + bw / 2} y={r + 50} textAnchor="middle" style={small}>
              {side === "out" ? "heat out" : "heat in"}
            </text>
            <path d={supply} stroke="var(--hot)" strokeWidth={3} fill="none" markerEnd="url(#flow-hot)" />
            <path d={ret} stroke="var(--cool-strong)" strokeWidth={3} fill="none" markerEnd="url(#flow-cold)" />
          </g>
        );
      })}
    </g>
  );
}
