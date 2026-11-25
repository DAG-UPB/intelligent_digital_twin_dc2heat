/**
 * Selecting several instruments with a box: a drag on the drawing (with Shift held, or in "Select" mode) draws a
 * rectangle; on release `onDone` gets its two corners in drawing units, and whether Shift was held (add to the
 * selection instead of replacing it).
 */
import { useState, type PointerEvent, type RefObject } from "react";

type Pt = { x: number; y: number };

export function useBoxSelect(svg: RefObject<SVGSVGElement | null>, onDone: (a: Pt, b: Pt, add: boolean) => void) {
  const [box, setBox] = useState<{ a: Pt; b: Pt } | null>(null);
  const start = (e: PointerEvent) => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return;
    const at = (x: number, y: number): Pt => new DOMPoint(x, y).matrixTransform(ctm.inverse());
    const [a, add] = [at(e.clientX, e.clientY), e.shiftKey];
    let b = a;
    setBox({ a, b });
    const move = (ev: globalThis.PointerEvent) => {
      b = at(ev.clientX, ev.clientY);
      setBox({ a, b });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox(null);
      onDone(a, b, add);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { box, start };
}
