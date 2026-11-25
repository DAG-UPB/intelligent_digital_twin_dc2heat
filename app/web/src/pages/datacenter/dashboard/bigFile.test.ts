import { describe, expect, it } from "vitest";
import { dayAfter } from "./BigFile";

describe("big file", () => {
  it("offers the first day as the period, whatever the time zone", () => {
    expect(dayAfter("2024-03-31T00:00:00")).toBe("2024-04-01T00:00"); // the night summer time starts in Europe
    expect(dayAfter("")).toBe("");
  });
});
