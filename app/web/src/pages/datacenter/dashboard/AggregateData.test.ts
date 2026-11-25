/** Aggregate data: the method a variable starts with, from its name. */
import { expect, test } from "vitest";
import { guessMethod } from "./AggregateData";

test("energies and counts add up, states keep their last value, the rest is averaged", () => {
  expect(guessMethod("ITE_Ener")).toBe("sum");
  expect(guessMethod("Heat_kWh")).toBe("sum");
  expect(guessMethod("Cool_Set")).toBe("last");
  expect(guessMethod("In_Temp")).toBe("mean");
});
