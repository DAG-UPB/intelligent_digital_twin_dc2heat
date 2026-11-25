import { describe, expect, it } from "vitest";
import { renamed, shownName, withOwnName } from "./names";

describe("names shown", () => {
  it("shows the given name, else the own one, and both on hover", () => {
    expect(shownName("u", { u: "Valve 3" })).toBe("Valve 3");
    expect(shownName("y", { u: "Valve 3" })).toBe("y");
    expect(withOwnName("u", { u: "Valve 3" })).toBe("Valve 3 (u)");
    expect(withOwnName("y", null)).toBe("y");
  });
  it("renames in bulk: text everywhere, or a regular expression; only what changes", () => {
    const vars = ["UDP//temp_flow rack_01", "UDP//temp_return rack_01", "Hour"];
    expect(renamed(vars, {}, "UDP//", "")).toEqual({ "UDP//temp_flow rack_01": "temp_flow rack_01", "UDP//temp_return rack_01": "temp_return rack_01" });
    expect(renamed(vars, {}, "^UDP//(\\w+) rack_(\\d+)$", "Rack $2 $1", true)).toEqual({
      "UDP//temp_flow rack_01": "Rack 01 temp_flow",
      "UDP//temp_return rack_01": "Rack 01 temp_return",
    });
    // it works on the names shown, and a name back to the own one is removed ("")
    expect(renamed(["u"], { u: "Valve 3" }, "Valve 3", "u")).toEqual({ u: "" });
    expect(renamed(vars, {}, "", "x")).toEqual({});
    expect(() => renamed(vars, {}, "(", "x", true)).toThrow();
  });
});
