import { describe, expect, it } from "vitest";
import { groupName, groupsIn, inBox, logged, memberOf, middleOf, withNotes, type Change } from "./notes";

describe("withNotes", () => {
  it("sets, keeps and removes the parts of a note; an empty note goes", () => {
    let n = withNotes({}, [{ variable: "A", kind: "sensor", confidence: "likely", note: "return temperature" }]);
    expect(n).toEqual({ A: { kind: "sensor", confidence: "likely", note: "return temperature" } });
    n = withNotes(n, [{ variable: "A", confidence: "sure" }]); // the kind and the note stay
    expect(n.A).toEqual({ kind: "sensor", confidence: "sure", note: "return temperature" });
    n = withNotes(n, [{ variable: "A", kind: null, confidence: null, note: null }]);
    expect(n).toEqual({});
  });
  it("refuses a kind or confidence that does not exist", () => {
    expect(() => withNotes({}, [{ variable: "A", kind: "magic" }])).toThrow(/kind "magic"/);
    expect(() => withNotes({}, [{ variable: "A", confidence: "maybe" }])).toThrow(/confidence "maybe"/);
  });
});

describe("groupName", () => {
  it("takes what the names share, as a variable name, plus the method", () => {
    expect(groupName(["CPU-UTIL-//CPU-1", "CPU-UTIL-//CPU-2", "CPU-UTIL-//CPU-12"], "mean", [])).toBe("CPU_UTIL_CPU_mean");
    expect(groupName(["rack1_T", "rack2_T"], "max", [])).toBe("rack_max");
  });
  it("falls back to group_<method> and stays unique", () => {
    expect(groupName(["a", "b"], "sum", [])).toBe("group_sum");
    expect(groupName(["a", "b"], "sum", ["group_sum", "group_sum_2"])).toBe("group_sum_3");
  });
});

describe("middleOf and inBox", () => {
  const pos = { A: { x: 0, y: 0, tag: "TT" }, B: { x: 10, y: 20, tag: "TT" }, C: { x: 100, y: 100, tag: "TT" } };
  it("puts a group in the middle of its members", () => {
    expect(middleOf(["A", "B"], pos)).toEqual({ x: 5, y: 10 });
    expect(middleOf(["Z"], pos)).toBeNull();
  });
  it("finds the instruments in a box dragged either way", () => {
    expect(inBox(["A", "B", "C"], pos, { x: 50, y: 50 }, { x: -1, y: -1 })).toEqual(["A", "B"]);
  });
});

it("logs newest first and keeps at most 200 entries", () => {
  let log: Change[] = [{ at: 0, by: "you", text: "first" }];
  for (let i = 1; i <= 250; i++) log = logged(log, { at: i, by: "AI", text: `n${i}` });
  expect(log).toHaveLength(200);
  expect(log[0].text).toBe("n250");
});

it("lists the groups marked and which group each member is in", () => {
  const notes = {
    rack1_mean: { group: { method: "mean" as const, members: ["c1", "c2"] } },
    all_max: { group: { method: "max" as const, members: ["c2", "c3"] }, kind: "it_load" as const },
    c1: { kind: "it_load" as const },
  };
  expect(groupsIn(notes).map((g) => `${g.name}:${g.method}:${g.members.length}`)).toEqual(["all_max:max:2", "rack1_mean:mean:2"]);
  expect(memberOf(notes)).toEqual({ c2: ["all_max", "rack1_mean"], c3: ["all_max"], c1: ["rack1_mean"] });
  expect(groupsIn(withNotes(notes, [{ variable: "rack1_mean", group: null }])).map((g) => g.name)).toEqual(["all_max"]);
});
