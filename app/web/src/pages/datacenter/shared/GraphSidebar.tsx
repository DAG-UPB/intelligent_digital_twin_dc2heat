/**
 * The causal graph on the left of a page (Visualization and Scenarios, the Modelling under Structure and Modelling):
 * pinned while scrolling, its width set by dragging the line beside it (or its arrow keys; a double click gives the
 * default back), a wider panel drawing a bigger graph. Dragged far to the left it closes; the tab left behind opens
 * it again. Width and open/closed are remembered in this browser, the same for every page that has it.
 */
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { MapWidth } from "./CausalMiniMap";
import "./graphSide.css";

export const GRAPH_SIDE = { min: 200, max: 640, initial: 292, close: 140 }; // px; below `close` while dragging it closes
const WIDTH_KEY = "graph-side-width";
const OPEN_KEY = "graph-side-open";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage off: the defaults, not remembered
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
};
const within = (w: number) => Math.round(Math.min(GRAPH_SIDE.max, Math.max(GRAPH_SIDE.min, w)));

export function GraphSidebar({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [width, setWidthState] = useState(() => within(Number(read(WIDTH_KEY)) || GRAPH_SIDE.initial));
  const [open, setOpenState] = useState(() => read(OPEN_KEY) !== "0");
  const setWidth = (w: number) => {
    setWidthState(within(w));
    write(WIDTH_KEY, String(within(w)));
  };
  const setOpen = (on: boolean) => {
    setOpenState(on);
    write(OPEN_KEY, on ? "1" : "0");
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const [x0, w0] = [e.clientX, width];
    const move = (ev: globalThis.PointerEvent) => {
      const w = w0 + ev.clientX - x0;
      if (w < GRAPH_SIDE.close) {
        setOpen(false); // dragged far to the left: closed
        up();
      } else setWidth(w);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") width - step < GRAPH_SIDE.min ? setOpen(false) : setWidth(width - step);
    else if (e.key === "ArrowRight") setWidth(width + step);
    else return;
    e.preventDefault();
  };

  if (!open)
    return (
      <button type="button" className="graph-side__open" onClick={() => setOpen(true)} aria-label="Show the causal graph" title="Show the causal graph">
        <span>Causal graph</span>
      </button>
    );
  return (
    <>
      <aside className="causal-aside graph-side" style={{ width }} aria-label="Causal graph panel">
        <div className="graph-side__sticky">
          <div className="graph-side__head">
            <div className="caps">{title}</div>
            <button
              type="button"
              className="btn btn--ghost btn--xs graph-side__close"
              onClick={() => setOpen(false)}
              aria-label="Hide the causal graph"
              title="Hide"
            >
              ‹
            </button>
          </div>
          <MapWidth.Provider value={width - 34 /* the panel's padding */}>{children}</MapWidth.Provider>
        </div>
      </aside>
      <div
        className="graph-side__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Causal graph width"
        aria-valuenow={width}
        aria-valuemin={GRAPH_SIDE.min}
        aria-valuemax={GRAPH_SIDE.max}
        tabIndex={0}
        onPointerDown={down}
        onKeyDown={key}
        onDoubleClick={() => setWidth(GRAPH_SIDE.initial)}
        title="Drag to make the graph wider or narrower; far to the left it closes (double click: default width)"
      />
    </>
  );
}
