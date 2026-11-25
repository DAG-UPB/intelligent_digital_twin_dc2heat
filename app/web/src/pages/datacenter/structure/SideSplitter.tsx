/**
 * The handle between a side panel and the drawing next to it (Physical structure, the Site map): drag it (or focus
 * it and use the arrow keys) to make the panel wider or narrower; a double click gives the default width back. The
 * width is remembered in this browser, per page (its key).
 */
import { useState, type KeyboardEvent, type PointerEvent } from "react";

export const SIDE = { min: 200, max: 640, initial: 260 }; // px
const KEY = "pid-side-width";
const within = (w: number) => Math.round(Math.min(SIDE.max, Math.max(SIDE.min, w)));

/** The side panel's width and its setter (kept within SIDE, remembered under `key`). */
export function useSideWidth(key = KEY, initial = SIDE.initial) {
  const [width, set] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v ? within(v) : initial;
    } catch {
      return initial; // localStorage off: the default, not remembered
    }
  });
  const setWidth = (w: number) => {
    const next = within(w);
    set(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // not remembered
    }
  };
  return [width, setWidth] as const;
}

export function SideSplitter({ width, onWidth, initial = SIDE.initial }: { width: number; onWidth: (w: number) => void; initial?: number }) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const [x0, w0] = [e.clientX, width];
    const z = Number(document.documentElement.style.zoom) || 1; // the app scaled to the window (main.tsx): the pointer moves in screen px
    const move = (ev: globalThis.PointerEvent) => onWidth(w0 + (ev.clientX - x0) / z); // the panel is on the left
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") onWidth(width - step);
    else if (e.key === "ArrowRight") onWidth(width + step);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="pid-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Side panel width"
      aria-valuenow={width}
      aria-valuemin={SIDE.min}
      aria-valuemax={SIDE.max}
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={() => onWidth(initial)}
      title="Drag to make the side panel wider or narrower (double click: default width)"
    />
  );
}
