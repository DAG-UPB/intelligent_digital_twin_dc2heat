/**
 * Zoom and pan of the drawing (view.ts) with the pointer: the wheel (or a trackpad pinch) over the drawing zooms
 * around the pointer, and dragging the empty drawing pans (a press without moving is a click). The canvas fits the
 * window (pid.css), so the window's shape is measured: a tall P&ID is reached by zooming in and panning down.
 * `locked`: the view stays as it is (no wheel zoom, no pan); a press still clicks.
 */
import { useEffect, useState, type PointerEvent, type RefObject } from "react";
import { W } from "./geometry";
import { clampView, fitted, panned, showing, viewBoxOf, windowOf, zoomedAt, zoomedBy, type Frame, type View } from "./view";

const STEP = 1.25; // one press of + or -
const SLOP = 4; // px a press may move and still be a click

export function useView(svg: RefObject<SVGSVGElement | null>, h: number, locked = false, span = { x0: 0, x1: W }) {
  const [raw, setView] = useState<View | null>(null); // null: fitted (the whole drawing, centred)
  const [ar, setAr] = useState<number | null>(null); // the canvas's height per width, once measured

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    // never taller than the page's scroll area: scrolled to (the canvas is sticky), all of it is on screen
    const page = el.closest(".app__page") ?? document.documentElement;
    const measure = () => {
      el.style.maxHeight = `${Math.max(360, page.clientHeight - 16)}px`;
      if (el.clientWidth > 0 && el.clientHeight > 0) setAr(el.clientHeight / el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(page);
    return () => ro.disconnect();
  }, [svg]);

  const w = span.x1 - span.x0; // the drawing, with its margins
  const f: Frame = { x0: span.x0, w, h, ar: ar ?? h / w }; // not measured yet: the drawing's own shape
  const view = raw ? clampView(raw, f) : fitted(f); // the drawing or the canvas may have changed since

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const ctm = el.getScreenCTM();
      if (!ctm || locked) return; // locked: the wheel scrolls the page as anywhere else
      e.preventDefault(); // over the drawing the wheel zooms it, not the page
      const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      // a pinch (ctrlKey) sends small steps, a mouse wheel ~100 per notch: one notch is ~15 %
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => zoomedAt(v ? clampView(v, f) : fitted(f), factor, at, f));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- f is made of h and ar
  }, [svg, h, ar, locked]);

  /** A press on the empty drawing: dragging pans, a press without moving calls `onClick`. */
  const startPan = (e: PointerEvent, onClick: () => void) => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return onClick();
    const [x0, y0, from] = [e.clientX, e.clientY, view];
    let moved = false;
    const move = (ev: globalThis.PointerEvent) => {
      const [dx, dy] = [ev.clientX - x0, ev.clientY - y0];
      if (!moved && Math.hypot(dx, dy) < SLOP) return;
      moved = true;
      if (!locked) setView(panned(from, -dx / ctm.a, -dy / ctm.d, f));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onClick();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return {
    view,
    window: windowOf(view, f), // the part of the drawing in view
    viewBox: viewBoxOf(view, f),
    zoomIn: () => !locked && setView(zoomedBy(view, STEP, f)),
    zoomOut: () => !locked && setView(zoomedBy(view, 1 / STEP, f)),
    fitted: raw === null,
    fit: () => !locked && setView(null),
    setView: (v: View) => setView(clampView(v, f)),
    show: (area: { x: number; y: number; w: number; h: number }) => !locked && setView(showing(area, f)), // zoomed onto an area
    startPan,
  };
}
