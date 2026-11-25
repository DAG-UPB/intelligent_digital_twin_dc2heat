/** Replay window sizes: spans offered as steps of the data's own resolution, the default, and the visible index range. */
import { durationLabel } from "../../../../lib/period";

/** Window lengths offered (seconds). */
const SPANS = [600, 3600, 6 * 3600, 86400, 7 * 86400, 30 * 86400, 91 * 86400, 365 * 86400];
/** The "All" window: more steps than any dataset has. */
export const ALL = 99999;

export interface Span {
  label: string;
  steps: number;
}

/** The spans that make sense for `n` points `stepSec` apart: at least 10 steps, fewer than the data has. */
export function windowsFor(stepSec: number, n: number): Span[] {
  return SPANS.map((sec) => ({ label: durationLabel(sec), steps: Math.round(sec / stepSec) })).filter((w) => w.steps >= 10 && w.steps < n);
}

/** A week, else the longest window offered, else All. */
export const defaultWindow = (windows: Span[]): number => windows.find((w) => w.label === "7 d")?.steps ?? windows[windows.length - 1]?.steps ?? ALL;

/** First and last index shown: half a window before the playhead, a whole window after the start. */
export function viewRange(playhead: number, windowSize: number, n: number): [number, number] {
  const start = Math.max(0, playhead - Math.floor(windowSize / 2));
  return [start, Math.min(n - 1, start + windowSize)];
}
