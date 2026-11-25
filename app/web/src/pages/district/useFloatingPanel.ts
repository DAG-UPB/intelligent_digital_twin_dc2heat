/**
 * The Site map's panel is a window over the map: its width (dragged at its edge), minimised or not, and its place
 * (dragged by its title bar, kept inside the map, remembered in this browser; `resetPos` puts it back). Shown whole:
 * a panel moved low goes up as far as what it holds needs (`top`, down to the map's bottom), its place kept.
 */
import { useEffect, useState, type PointerEvent, type RefObject } from "react";
import { FLAG, readJson, useStored, writeJson } from "../../lib/storage";
import { useSideWidth } from "../datacenter/structure/SideSplitter";

export const PANEL_WIDTH = 300; // px, the panel's default width (drag its edge to change it)
const POS_KEY = "site-panel-pos"; // where the panel was moved to over the map, in this browser
const POS = { x: 56, y: 12 }; // at first: right of the map's zoom buttons

export function useFloatingPanel(panel: RefObject<HTMLElement | null>) {
  const [panelWidth, setPanelWidth] = useSideWidth("site-panel-width", PANEL_WIDTH);
  const [min, setMin] = useStored("site-panel-min", false, FLAG);
  const [pos, setPos] = useState(() => ({ ...POS, ...readJson<Partial<typeof POS> | null>(POS_KEY, {}) }));
  const dragPanel = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); // no text selection while dragging
    const z = Number(document.documentElement.style.zoom) || 1; // the pointer moves in screen px (main.tsx's zoom)
    const box = e.currentTarget.closest(".site")!.getBoundingClientRect();
    const [x0, y0, p0] = [e.clientX, e.clientY, pos];
    let last = pos;
    const move = (ev: globalThis.PointerEvent) => {
      last = {
        x: Math.round(Math.min(box.width / z - 80, Math.max(0, p0.x + (ev.clientX - x0) / z))),
        y: Math.round(Math.min(box.height / z - 40, Math.max(0, p0.y + (ev.clientY - y0) / z))),
      };
      setPos(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      writeJson(POS_KEY, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resetPos = () => {
    setPos(POS);
    writeJson(POS_KEY, null);
  };
  // only what is taller than the map scrolls inside it
  const [top, setTop] = useState(pos.y);
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const fit = () => setTop(Math.max(Math.min(pos.y, 12), Math.min(pos.y, p.parentElement!.clientHeight - p.scrollHeight - 16)));
    const seen = new ResizeObserver(fit);
    [p, ...p.children].forEach((c) => seen.observe(c));
    fit();
    return () => seen.disconnect();
  }, [pos.y, min, panel]);
  return { panelWidth, setPanelWidth, min, setMin, pos, top, dragPanel, resetPos };
}
