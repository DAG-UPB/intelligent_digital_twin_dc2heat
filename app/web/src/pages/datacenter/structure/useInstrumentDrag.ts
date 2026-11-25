/**
 * Dragging an instrument on the drawing with the pointer: snapped to the grid, kept inside the viewBox.
 * A press and release without moving is a click (`onClick`); a real move ends with `onMoved`, then `onDropped`.
 */
import { useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from "react";
import { clamp, R, snap, W } from "./geometry";
import type { Pos } from "./layout";

export function useInstrumentDrag(
  svg: RefObject<SVGSVGElement | null>,
  viewH: number,
  setPos: Dispatch<SetStateAction<Pos>>,
  onMoved: () => void,
  onClick: (v: string) => void,
  span = { x0: 0, x1: W }, // the drawing's ends: with the connection points' margins beside a picture
  onDropped?: (v: string) => void, // after a real move: the page looks whether it landed on another variable
) {
  const [drag, setDrag] = useState<{ v: string; moved: boolean } | null>(null);

  const svgPoint = (e: PointerEvent) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: snap(clamp(pt.x, span.x0 + R, span.x1 - R)), y: snap(clamp(pt.y, R, viewH - R)) };
  };

  const start = (v: string, e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ v, moved: false });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = svgPoint(e);
    setPos((ps) => (ps[drag.v].x === p.x && ps[drag.v].y === p.y ? ps : { ...ps, [drag.v]: { ...ps[drag.v], ...p } }));
    if (!drag.moved) setDrag({ ...drag, moved: true });
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.moved) {
      onMoved();
      onDropped?.(drag.v);
    } else onClick(drag.v);
    setDrag(null);
  };

  return { start, onMove, onUp };
}
