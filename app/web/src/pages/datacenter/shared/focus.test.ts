import { expect, test } from "vitest";
import { nextPick } from "./focus";

test("a click picks a variable, a second click on it releases it, a third picks it again", () => {
  const a = nextPick(null, "In_Temp");
  expect(a).toEqual({ v: "In_Temp", n: 1 });
  const b = nextPick(a, "In_Temp");
  expect(b).toEqual({ v: "In_Temp", n: 2, off: true });
  expect(nextPick(b, "In_Temp")).toEqual({ v: "In_Temp", n: 3 });
  expect(nextPick(a, "Cool_Set")).toEqual({ v: "Cool_Set", n: 2 }); // another variable: picked
});
