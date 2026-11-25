/**
 * The digital construct drawn over the P&ID picture (construct.ts): the sheet's own lines and texts ("drawing", in
 * their colours) and on them the recognised rectangles, circles, lines and text. While the construct is edited, a
 * shape is grabbed to move it (its corner handle resizes it), and a drawing tool draws a new one by dragging (a click
 * gives the default size). Coordinates are fractions of the drawing (W x frameH). A sheet has thousands of shapes:
 * each one renders on its own (memo) and only again when it changes.
 */
import { memo, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ShapeKind } from "../../../api";
import { drawn, moved, resized, type Shape, type XY } from "./construct";
import { W } from "./geometry";

export type Tool = "select" | ShapeKind;

const COLOUR: Record<string, string> = {
  component: "var(--accent)",
  instrument: "var(--ok)",
  pipe: "var(--cool-strong)",
  note: "var(--foreground)",
  drawing: "var(--foreground)",
  "": "var(--foreground-secondary)",
};
const HANDLE = 8;

/** A drawing shape's colour: its own, except black, which follows the theme (it would vanish in dark mode). */
const colourOf = (s: Shape) => (s.role === "drawing" && s.color && s.color !== "#000000" ? s.color : (COLOUR[s.role] ?? COLOUR[""]));

interface Props {
  svg: RefObject<SVGSVGElement | null>;
  shapes: Shape[];
  frameH: number; // the drawing's height in viewBox units (its width is W)
  opacity: number;
  editing: boolean;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string) => void;
  onShape: (s: Shape) => void; // a shape changed while dragging
  onDone: () => void; // a drag ended with a change
  onCreate: (s: Shape) => void;
}

export function ConstructLayer(p: Props) {
  const [draft, setDraft] = useState<Shape | null>(null); // the shape being drawn
  const latest = useRef(p);
  latest.current = p;

  const frac = (e: { clientX: number; clientY: number }): XY => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(latest.current.svg.current!.getScreenCTM()!.inverse());
    return { x: pt.x / W, y: pt.y / latest.current.frameH };
  };

  /** Follow the pointer until it is released: `step` gets every position, `end` the last one. */
  const follow = (e: ReactPointerEvent, step: (at: XY) => void, end: (at: XY) => void) => {
    e.stopPropagation(); // not the background's (which pans, or clears the selection)
    const move = (ev: PointerEvent) => step(frac(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      end(frac(ev));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const draw = (e: ReactPointerEvent) => {
    const { tool, shapes, onCreate } = latest.current;
    if (tool === "select") return;
    const a = frac(e);
    setDraft(drawn(tool, a, a, shapes));
    follow(
      e,
      (b) => setDraft(drawn(tool, a, b, latest.current.shapes)),
      (b) => {
        setDraft(null);
        onCreate(drawn(tool, a, b, latest.current.shapes));
      },
    );
  };

  /** A press on a shape (or its resize handle): stable, so a shape re-renders only when it changes itself. */
  const onDown = useCallback((s: Shape, e: ReactPointerEvent, handle: boolean) => {
    const cur = latest.current;
    if (!cur.editing) return;
    if (handle)
      return follow(
        e,
        (at) => latest.current.onShape(resized(s, at)),
        () => latest.current.onDone(),
      );
    if (cur.tool !== "select") return draw(e); // drawing over a shape draws, as anywhere else
    cur.onSelect(s.id);
    const start = frac(e);
    let changed = false;
    follow(
      e,
      (at) => {
        changed = true;
        latest.current.onShape(moved(s, at.x - start.x, at.y - start.y));
      },
      () => changed && latest.current.onDone(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest props through the ref
  }, []);

  const grabbable = p.editing && p.tool === "select";
  return (
    <g opacity={p.opacity} pointerEvents={p.editing ? undefined : "none"} aria-label="Digital construct">
      {p.editing && p.tool !== "select" && <rect width={W} height={p.frameH} fill="transparent" style={{ cursor: "crosshair" }} onPointerDown={draw} />}
      {p.shapes.map((s) => (
        <ShapeView key={s.id} s={s} sel={s.id === p.selected} editing={p.editing} grabbable={grabbable} frameH={p.frameH} onDown={onDown} />
      ))}
      {draft && <ShapeView s={draft} sel={false} editing={false} grabbable={false} frameH={p.frameH} onDown={onDown} isDraft />}
    </g>
  );
}

interface ViewProps {
  s: Shape;
  sel: boolean;
  editing: boolean;
  grabbable: boolean;
  frameH: number;
  onDown: (s: Shape, e: ReactPointerEvent, handle: boolean) => void;
  isDraft?: boolean;
}

const ShapeView = memo(function ShapeView({ s, sel, editing, grabbable, frameH, onDown, isDraft }: ViewProps) {
  const px = (x: number) => x * W;
  const py = (y: number) => y * frameH;
  const colour = sel ? "var(--accent)" : colourOf(s);
  const sheet = s.role === "drawing"; // the drawing itself: hairlines, as on the paper
  const stroke = {
    stroke: colour,
    strokeWidth: sheet ? (sel ? 2 : 0.8) : sel ? 2.5 : 1.5,
    strokeDasharray: isDraft ? "5 3" : undefined,
    vectorEffect: sheet ? ("non-scaling-stroke" as const) : undefined,
  };
  const events = { onPointerDown: (e: ReactPointerEvent) => onDown(s, e, false), style: { cursor: grabbable ? "move" : undefined } };
  const values = s.props ? Object.entries(s.props).map(([k, v]) => `${k}: ${v}`) : [];
  const tip = sheet && !sel ? null : <title>{[s.label || s.id, ...values].join("\n")}</title>;
  if (s.kind === "line") {
    const pts = (s.points ?? []).map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
    return (
      <g data-shape={s.id}>
        {tip}
        <polyline points={pts} fill="none" {...stroke} strokeOpacity={sel || sheet ? 1 : 0.7} pointerEvents="none" />
        {editing && <polyline points={pts} fill="none" stroke="transparent" strokeWidth={8} vectorEffect="non-scaling-stroke" {...events} />}
      </g>
    );
  }
  if (s.kind === "text")
    return (
      <text
        data-shape={s.id}
        x={px(s.x ?? 0)}
        y={py(s.y ?? 0)}
        className={sheet ? undefined : "pid-halo"}
        style={{ font: sheet ? `${sel ? 700 : 400} 8px sans-serif` : `${sel ? 700 : 600} 12px sans-serif`, fill: colour, ...events.style }}
        onPointerDown={events.onPointerDown}
      >
        {s.label || "Text"}
      </text>
    );
  const [cx, cy, w, h] = [px(s.x ?? 0), py(s.y ?? 0), px(s.w ?? 0), py(s.h ?? 0)];
  const fill = { fill: colour, fillOpacity: sel ? 0.16 : 0.06 };
  return (
    <g data-shape={s.id}>
      {tip}
      {s.kind === "rect" ? (
        <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={2} {...fill} {...stroke} {...events} />
      ) : (
        <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...fill} {...stroke} {...events} />
      )}
      {s.label && (
        <text x={cx} y={cy - h / 2 - 4} textAnchor="middle" className="pid-halo" style={{ font: "600 10px sans-serif", fill: colour }} pointerEvents="none">
          {s.label}
        </text>
      )}
      {sel && editing && (
        <rect
          x={cx + w / 2 - HANDLE / 2}
          y={cy + h / 2 - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          fill="var(--surface)"
          stroke={colour}
          style={{ cursor: "nwse-resize" }}
          onPointerDown={(e) => onDown(s, e, true)}
          aria-label={`Resize ${s.id}`}
        />
      )}
    </g>
  );
});
