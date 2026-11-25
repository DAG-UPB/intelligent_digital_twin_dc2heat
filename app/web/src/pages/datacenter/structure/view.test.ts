import { describe, expect, it } from "vitest";
import { clampView, fitted, panned, showing, viewBoxOf, windowOf, zoomedAt, zoomedBy } from "./view";

const f = { w: 1000, h: 800, ar: 0.8 }; // the canvas has the drawing's shape
const WHOLE = fitted(f);

describe("view", () => {
  it("zooms around the pointer, which stays where it is", () => {
    const v = zoomedAt(WHOLE, 2, { x: 300, y: 200 }, f);
    expect(v).toEqual({ zoom: 2, x: 150, y: 100 });
    // the drawing point under the pointer: same fraction of the window before and after
    expect((300 - v.x) / (1000 / v.zoom)).toBeCloseTo(300 / 1000);
  });

  it("stays on the drawing", () => {
    expect(zoomedBy(WHOLE, 0.5, f)).toEqual(WHOLE); // never smaller than the whole drawing
    expect(zoomedBy(WHOLE, 100, f).zoom).toBe(16);
    const v = zoomedBy(WHOLE, 2, f);
    // dragged as far as the drawing's edge reaching the middle of the window (500 x 400 at zoom 2)
    expect(panned(v, 5000, -5000, f)).toEqual({ zoom: 2, x: 750, y: -200 });
    expect(clampView({ x: -9000, y: 9, zoom: 1 }, f)).toEqual({ x: -500, y: 9, zoom: 1 }); // also at zoom 1
  });

  it("fits a drawing taller than the canvas, then zoomed in it pans all the way down", () => {
    const tall = { w: 1000, h: 3000, ar: 0.8 };
    expect(windowOf(fitted(tall), tall)).toEqual({ x: -1375, y: 0, w: 3750, h: 3000 }); // centred, whole height
    const v = zoomedBy(fitted(tall), 4, tall);
    expect(windowOf(v, tall).h).toBe(750);
    expect(panned(v, 0, 1e6, tall).y).toBe(3000 - 750 / 2); // past the bottom of the drawing, to the middle
  });

  it("gives the viewBox", () => {
    expect(viewBoxOf({ x: 10, y: 20, zoom: 4 }, f)).toBe("10 20 250 200");
  });
});

it("shows an area as big as it fits, centred", () => {
  const v = showing({ x: 500, y: 400, w: 250, h: 100 }, f); // the area's width limits: zoom 4
  expect(v.zoom).toBe(4);
  const win = windowOf(v, f);
  expect(win.x + win.w / 2).toBeCloseTo(625);
  expect(win.y + win.h / 2).toBeCloseTo(450);
  expect(showing({ x: 0, y: 0, w: 1, h: 1 }, f).zoom).toBe(16); // at most MAX_ZOOM
});
