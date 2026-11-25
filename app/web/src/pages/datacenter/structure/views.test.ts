import { describe, expect, it } from "vitest";
import { areaOf, fromView, outerFirst, shownAs, toView, viewAt, viewId } from "./views";

const unit = { id: "unit", name: "Unit", x: 0.5, y: 0.5, w: 0.4, h: 0.4 };
const pump = { id: "pump", name: "Pump", x: 0.6, y: 0.6, w: 0.1, h: 0.1 }; // inside unit

describe("views", () => {
  it("finds the innermost view holding a spot", () => {
    expect(viewAt([unit, pump], 0.65, 0.65)?.id).toBe("pump");
    expect(viewAt([unit, pump], 0.55, 0.85)?.id).toBe("unit");
    expect(viewAt([unit, pump], 0.1, 0.1)).toBeNull();
    expect(outerFirst([pump, unit]).map((v) => v.id)).toEqual(["unit", "pump"]);
  });
  it("turns a spot in a view's own picture into one on the P&ID and back", () => {
    expect(fromView(unit, 0.5, 0.25)).toEqual({ x: 0.7, y: 0.6 });
    const back = toView(unit, 0.7, 0.6);
    expect(back.x).toBeCloseTo(0.5);
    expect(back.y).toBeCloseTo(0.25);
  });
  it("makes unique ids from names", () => {
    expect(viewId("Cooling unit 1", [])).toBe("cooling-unit-1");
    expect(viewId("Cooling unit 1", ["cooling-unit-1"])).toBe("cooling-unit-1-2");
    expect(viewId("§§", [])).toBe("view");
  });
  it("takes a dragged area in either direction, kept on the drawing; a tiny one is refused", () => {
    expect(areaOf({ x: 600, y: 300 }, { x: 200, y: 100 }, 1000, 500)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.4 });
    expect(areaOf({ x: -50, y: 0 }, { x: 100, y: 600 }, 1000, 500)).toEqual({ x: 0, y: 0, w: 0.1, h: 1 });
    expect(areaOf({ x: 0, y: 0 }, { x: 5, y: 100 }, 1000, 500)).toBeNull();
  });
});

describe("shownAs", () => {
  it("auto is a box while the view is small on screen, its picture when zoomed into", () => {
    expect(shownAs(unit, "own", true, 0.1)).toBe("box");
    expect(shownAs(unit, "own", true, 0.5)).toBe("picture");
    expect(shownAs({ ...unit, show: "sheet" }, "own", true, 0.9)).toBe("sheet");
  });
  it("the layer bar's choice wins over each view's; a missing picture is the sheet", () => {
    expect(shownAs({ ...unit, show: "picture" }, "box", true, 0.9)).toBe("box");
    expect(shownAs(unit, "picture", false, 0.1)).toBe("sheet");
    expect(shownAs(unit, "own", false, 0.9)).toBe("sheet");
    expect(shownAs(unit, "own", false, 0.1)).toBe("sheet"); // auto without a picture yet: what the area holds
    expect(shownAs(unit, "box", false, 0.9)).toBe("box");
  });
});
