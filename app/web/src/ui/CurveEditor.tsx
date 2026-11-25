/**
 * Curves over a day to draw (any number of points, spread over 24 h): drag a point to reshape a curve, grab a line
 * to move the whole curve up or down; on a focused point or line the arrow keys do the same (Shift: bigger steps).
 * The axis top stays put while dragging, so the point follows the pointer. Edits reach `onChange` once per
 * animation frame, so a page that recomputes a year on each stays smooth. SVG, theme tokens.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmt } from "../lib/format";

export interface Curve {
  name: string;
  values: number[];
  color: string;
}

type Drag = { curve: number; top: number } & ({ i: number } | { grab: number; base: number[] });

const W = 960;
const H = 220;
const P = { l: 64, r: 20, t: 12, b: 22 };
const x = (h: number) => P.l + (h / 24) * (W - P.l - P.r);
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;

export function CurveEditor({
  label,
  curves,
  unit,
  onChange,
}: {
  label: string;
  curves: Curve[];
  unit: string;
  onChange: (curve: number, values: number[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const pending = useRef<[number, number[]] | null>(null);
  const frame = useRef(0);
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (pending.current) onChange(...pending.current);
    pending.current = null;
  };
  const schedule = (curve: number, values: number[]) => {
    pending.current = [curve, values];
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const top = drag?.top ?? Math.max(1e-9, ...curves.flatMap((c) => c.values)) * 1.25;
  const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b);
  const hourOf = (c: Curve, i: number) => (i * 24) / c.values.length;
  // a drag is batched per frame; a key press applies at once (presses can come faster than frames, and each one
  // builds on the curve as the last one left it)
  const set = (curve: number, values: number[], now = false) => {
    const clamped = values.map((v) => Math.min(top, Math.max(0, v)));
    if (!now) return schedule(curve, clamped);
    pending.current = null;
    onChange(curve, clamped);
  };
  const setPoint = (curve: number, i: number, v: number, now = false) =>
    set(
      curve,
      curves[curve].values.map((p, j) => (j === i ? v : p)),
      now,
    );
  // capped so the peak stays on the (frozen) axis: clamping single points would flatten the shape
  const scale = (curve: number, f: number, base = curves[curve].values, now = false) =>
    set(
      curve,
      base.map((p) => p * Math.min(Math.max(0, f), top / Math.max(1e-9, ...base))),
      now,
    );
  const valueAt = (e: PointerEvent, axisTop: number) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return ((H - P.b - pt.y) / (H - P.t - P.b)) * axisTop;
  };
  const start = (e: PointerEvent, d: Drag) => {
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    setDrag(d);
  };
  const move = (e: PointerEvent) => {
    if (!drag || !svg.current) return;
    const v = valueAt(e, drag.top);
    if ("i" in drag) setPoint(drag.curve, drag.i, v);
    else if (drag.grab > 0) scale(drag.curve, v / drag.grab, drag.base);
  };
  const end = () => {
    flush();
    setDrag(null);
  };
  const keyStep = (e: KeyboardEvent) => (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0) * (e.shiftKey ? 5 : 1);

  return (
    <figure className="curve-editor">
      <figcaption className="caps">{label}</figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        aria-label={`${label}: drag the points to reshape and the lines to move them`}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={P.t} y2={H - P.b} stroke="var(--border)" strokeWidth={1} />
            <text x={x(h)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--foreground-secondary)" className="mono">
              {hh(h)}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(f * top)} y2={y(f * top)} stroke={f ? "var(--border)" : "var(--border-strong)"} strokeWidth={1} />
            <text x={P.l - 6} y={y(f * top) + 3} fontSize={10} textAnchor="end" fill="var(--foreground-secondary)" className="mono">
              {f === 1 ? `${fmt(f * top, 2)} ${unit}` : fmt(f * top, 2)}
            </text>
          </g>
        ))}
        {curves.map((c, k) => {
          const pts = [...c.values, c.values[0]].map((v, i) => `${x(hourOf(c, i))},${y(v)}`).join(" ");
          return (
            <g key={c.name}>
              <polyline points={pts} fill="none" stroke={c.color} strokeWidth={1.5} strokeLinejoin="round" pointerEvents="none" />
              {/* a wide invisible line: grab it to move the whole curve; arrow keys do the same */}
              <polyline
                points={pts}
                fill="none"
                stroke="transparent"
                strokeWidth={10}
                className="curve-editor__line"
                tabIndex={0}
                role="slider"
                aria-label={`${c.name}, level`}
                aria-valuenow={+(c.values.reduce((a, b) => a + b, 0) / c.values.length).toFixed(3)}
                onPointerDown={(e) => start(e, { curve: k, top, grab: valueAt(e, top), base: c.values })}
                onKeyDown={(e) => {
                  const d = keyStep(e);
                  if (!d) return;
                  e.preventDefault();
                  scale(k, 1 + d * 0.02, undefined, true);
                }}
              />
              {c.values.map((v, i) => {
                const on = drag && "i" in drag && drag.curve === k && drag.i === i;
                return (
                  <g key={i} className="curve-editor__point">
                    <circle cx={x(hourOf(c, i))} cy={y(v)} r={on ? 5 : 3} fill="var(--surface)" stroke={c.color} strokeWidth={1.5} pointerEvents="none" />
                    <circle
                      cx={x(hourOf(c, i))}
                      cy={y(v)}
                      r={7}
                      fill="transparent"
                      tabIndex={0}
                      role="slider"
                      aria-label={`${c.name}, ${hh(hourOf(c, i))}`}
                      aria-valuenow={+v.toFixed(3)}
                      aria-valuetext={`${fmt(v, 2)} ${unit}`}
                      aria-valuemin={0}
                      onPointerDown={(e) => start(e, { curve: k, top, i })}
                      onKeyDown={(e) => {
                        const d = keyStep(e);
                        if (!d) return;
                        e.preventDefault();
                        setPoint(k, i, v + (d * top) / 50, true);
                      }}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted curve-editor__legend">
        {curves.map((c) => (
          <span key={c.name}>
            <i style={{ background: c.color }} /> {c.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
