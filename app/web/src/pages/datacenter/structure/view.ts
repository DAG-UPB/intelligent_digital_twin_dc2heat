/**
 * Zoom and pan of the Physical structure drawing: which part of the w x h drawing the SVG shows (its viewBox).
 * Everything on the drawing keeps its own coordinates; only the window onto it moves. The window has the canvas's
 * shape (`ar`: its height per width), and zoom 1 fits the whole drawing into it: a P&ID taller than the screen is
 * shrunk to fit, then zoomed in with the wheel and panned down by dragging. The drawing can be dragged at every
 * zoom, as far as its edges reaching the middle of the window. Pure functions only.
 */
export interface View {
  x: number; // top-left corner of the window, in drawing units
  y: number;
  zoom: number; // 1: the whole drawing
}
/** The drawing's size and the canvas's shape (height / width on screen). */
export interface Frame {
  w: number;
  h: number;
  ar: number;
  x0?: number; // the drawing's left end (a margin left of the picture: negative); 0 by default
}
export const MAX_ZOOM = 16;

/** The window at zoom 1: the canvas's shape, just big enough for the whole drawing. */
function base({ w, h, ar }: Frame) {
  const bw = Math.max(w, h / ar);
  return { bw, bh: bw * ar };
}

/** The view kept on the drawing: zoom 1..MAX_ZOOM, the window's middle over the drawing (so it never gets lost). */
export function clampView(v: View, f: Frame): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const { bw, bh } = base(f);
  const [ww, wh] = [bw / zoom, bh / zoom];
  const x0 = f.x0 ?? 0;
  return { x: Math.min(x0 + f.w - ww / 2, Math.max(x0 - ww / 2, v.x)), y: Math.min(f.h - wh / 2, Math.max(-wh / 2, v.y)), zoom };
}

/** The whole drawing, centred in the window (Fit). */
export function fitted(f: Frame): View {
  const { bw, bh } = base(f);
  return { x: (f.x0 ?? 0) + (f.w - bw) / 2, y: (f.h - bh) / 2, zoom: 1 };
}

/** The part of the drawing the view shows, in drawing units. */
export function windowOf(v: View, f: Frame) {
  const { bw, bh } = base(f);
  return { x: v.x, y: v.y, w: bw / v.zoom, h: bh / v.zoom };
}

/** Zoomed by `factor` around the drawing point `at` (it stays under the pointer). */
export function zoomedAt(v: View, factor: number, at: { x: number; y: number }, f: Frame): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
  const k = v.zoom / zoom;
  return clampView({ zoom, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, f);
}

/** Zoomed by `factor` around the middle of the window (the + and - buttons). */
export function zoomedBy(v: View, factor: number, f: Frame): View {
  const win = windowOf(v, f);
  return zoomedAt(v, factor, { x: win.x + win.w / 2, y: win.y + win.h / 2 }, f);
}

/** Moved by (dx, dy) drawing units. */
export const panned = (v: View, dx: number, dy: number, f: Frame) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, f);

/** The SVG viewBox of the view. */
export function viewBoxOf(v: View, f: Frame) {
  const win = windowOf(v, f);
  return `${win.x} ${win.y} ${win.w} ${win.h}`;
}

/** The view showing this area (drawing units) as big as it fits, centred (a P&ID view's Open). */
export function showing(area: { x: number; y: number; w: number; h: number }, f: Frame): View {
  const { bw, bh } = base(f);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Math.min(bw / area.w, bh / area.h)));
  return clampView({ zoom, x: area.x + area.w / 2 - bw / zoom / 2, y: area.y + area.h / 2 - bh / zoom / 2 }, f);
}
