import { describe, expect, it } from "vitest";
import { areaBetween, centreOf, drawn, edited, moved, newId, resized, valueOf, type Shape } from "./construct";

const box: Shape = { id: "rect:1", kind: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.1, label: "P1", role: "component" };

describe("construct", () => {
  it("reads typed values as numbers when they are", () => {
    expect([valueOf("50"), valueOf("0.8"), valueOf("chiller"), valueOf(" ")]).toEqual([50, 0.8, "chiller", " "]);
  });

  it("turns a drag on the import preview into an area of the page", () => {
    expect(areaBetween({ x: 0.8, y: 0.9 }, { x: 0.1, y: 0.2 })).toEqual([0.1, 0.2, 0.8, 0.9]); // any direction
    expect(areaBetween({ x: -0.2, y: 0.5 }, { x: 0.5, y: 1.4 })).toEqual([0, 0.5, 0.5, 1]); // kept on the page
    expect(areaBetween({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 })).toBeNull(); // a click, not a selection
  });

  it("gives new shapes free ids", () => {
    expect(newId([box], "rect")).toBe("rect:2");
    expect(newId([box], "circle")).toBe("circle:1");
  });

  it("draws a rectangle from a drag and a default one from a click", () => {
    const d = drawn("rect", { x: 0.1, y: 0.2 }, { x: 0.3, y: 0.3 }, []);
    expect(d).toMatchObject({ kind: "rect", x: 0.2, y: 0.25, w: 0.2, h: 0.1, role: "component" });
    const c = drawn("circle", { x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 }, []);
    expect(c).toMatchObject({ x: 0.4, y: 0.4, w: 0.025, h: 0.035, role: "instrument" });
    expect(drawn("line", { x: 0, y: 0 }, { x: 0.5, y: 0.5 }, []).points).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);
    expect(drawn("text", { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }, []).label).toBe("Text");
  });

  it("moves, resizes and edits", () => {
    expect(moved(box, 0.1, -0.1)).toMatchObject({ x: 0.6, y: 0.4 });
    const line: Shape = {
      id: "l",
      kind: "line",
      points: [
        [0, 0],
        [0.2, 0.4],
      ],
      label: "",
      role: "pipe",
    };
    expect(moved(line, 0.1, 0.1).points).toEqual([
      [0.1, 0.1],
      [0.3, 0.5],
    ]);
    expect(centreOf(line)).toEqual({ x: 0.1, y: 0.2 });
    // the top-left corner (0.4, 0.45) stays, the bottom-right one follows the handle
    expect(resized(box, { x: 0.8, y: 0.65 })).toMatchObject({ x: 0.6, y: 0.55, w: 0.4, h: 0.2 });
    expect(edited(box, { label: "Pump 1", w: 5, x: 9 })).toMatchObject({ label: "Pump 1", w: 1, x: 1.5 });
    expect(edited(line, { x: 0.3 }).x).toBeUndefined(); // a line has points, not x / y
    const valued = edited(box, { props: { capacity_kW: 50, type: "chiller" } });
    expect(edited(valued, { props: { type: null, cop: 3.2 } }).props).toEqual({ capacity_kW: 50, cop: 3.2 });
    expect(edited(valued, { props: { capacity_kW: "", type: null } }).props).toBeUndefined();
  });
});
