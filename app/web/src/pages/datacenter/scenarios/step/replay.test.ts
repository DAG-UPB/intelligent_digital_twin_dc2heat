/** The replay reducer: speed cycle, seek clamping, and playback stopping at the end. */
import { expect, test } from "vitest";
import { initialReplay, replayReducer } from "./replay";

test("speed cycles 10 -> 60 -> 360 -> 1 -> 10", () => {
  let s = initialReplay;
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((s = replayReducer(s, { type: "speed" })).speed);
  expect(seen).toEqual([60, 360, 1, 10]);
});

test("seek clamps to the data", () => {
  expect(replayReducer(initialReplay, { type: "seek", index: 50, n: 10 }).index).toBe(9);
  expect(replayReducer(initialReplay, { type: "seek", index: -3, n: 10 }).index).toBe(0);
  expect(replayReducer(initialReplay, { type: "seek", index: 0, n: 0 }).index).toBe(0);
});

test("advancing moves the playhead and stops playing at the last point", () => {
  const playing = { ...initialReplay, playing: true, index: 5 };
  expect(replayReducer(playing, { type: "advance", steps: 2, n: 10 })).toMatchObject({ index: 7, playing: true });
  expect(replayReducer(playing, { type: "advance", steps: 9, n: 10 })).toMatchObject({ index: 9, playing: false });
});
