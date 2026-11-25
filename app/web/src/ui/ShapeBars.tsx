/**
 * A shape to draw: one bar per value (24 hours, 7 weekdays, 12 months, ...), relative factors, never below 0. Drag a
 * bar (mouse or touch) to set it; on a focused bar the arrow keys change it by 5 % of the tallest (Shift: 20 %).
 * The bars keep their scale while dragging, so a bar can grow above the others. Without `onChange` it only shows
 * the values (a result, e.g. per month). Every set of bars is the same height on screen (CSS), whatever its width;
 * the labels sit under them as text. SVG, theme tokens.
 */
import { fmt } from "../lib/format";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const H = 100; // the bars' box, stretched to the CSS height

export function ShapeBars({ label, values, ticks, onChange }: { label: string; values: number[]; ticks: string[]; onChange?: (v: number[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const top = Math.max(...values, 1e-9) * 1.2; // the value at the top of the box
  const n = values.length;
  const W = n * 20;
  const bw = W / n;
  const set = (i: number, v: number) => onChange?.(values.map((x, j) => (j === i ? Math.max(0, Math.round(v * 1000) / 1000) : x)));

  const down = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !onChange) return;
    e.preventDefault();
    const scale = top; // fixed while dragging
    const at = (ev: { clientX: number; clientY: number }) => {
      const i = Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - box.left) / box.width) * n)));
      const frac = 1 - (ev.clientY - box.top) / box.height;
      return [i, Math.max(0, frac) * scale] as const;
    };
    let cur = values;
    const apply = (ev: { clientX: number; clientY: number }) => {
      const [i, v] = at(ev);
      cur = cur.map((x, j) => (j === i ? Math.round(v * 1000) / 1000 : x));
      onChange(cur);
    };
    apply(e);
    const move = (ev: globalThis.PointerEvent) => apply(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const key = (i: number) => (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 0.2 : 0.05) * (top / 1.2);
    if (e.key === "ArrowUp") set(i, values[i] + step);
    else if (e.key === "ArrowDown") set(i, values[i] - step);
    else return;
    e.preventDefault();
  };

  return (
    <figure className={`shape-bars${onChange ? "" : " shape-bars--result"}`}>
      <figcaption className="caps">{label}</figcaption>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} role="group" aria-label={label}>
        <rect width={W} height={H} fill="var(--surface-2)" />
        {values.map((v, i) => {
          const h = (v / top) * H;
          return (
            <g key={i}>
              <rect
                x={i * bw + 1}
                y={H - h}
                width={bw - 2}
                height={h}

                fill={onChange ? "var(--accent)" : "var(--heat)"}
                {...(onChange
                  ? { tabIndex: 0, role: "slider", "aria-label": `${label} ${ticks[i]}`, "aria-valuenow": v, "aria-valuemin": 0, onKeyDown: key(i) }
                  : { "aria-label": `${ticks[i]}: ${Math.round(v)}` })}
              >
                {!onChange && <title>{`${ticks[i]}: ${fmt(v)}`}</title>}
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="shape-bars__ticks" aria-hidden>
        {ticks.map((t, i) => (
          <span key={i}>{n <= 12 || i % Math.ceil(n / 12) === 0 ? t : ""}</span>
        ))}
      </div>
    </figure>
  );
}
