/** Replay player state (playhead, playing, speed) as a pure reducer, so the animation loop has no side effects in updaters. */

/** Playback speeds in data points per second; the badge cycles through them. */
export const SPEEDS = [1, 10, 60, 360];

export interface Replay {
  index: number;
  playing: boolean;
  speed: number;
}

export type ReplayAction =
  | { type: "toggle" }
  | { type: "speed" }
  | { type: "seek"; index: number; n: number }
  | { type: "advance"; steps: number; n: number };

export const initialReplay: Replay = { index: 0, playing: false, speed: 10 };

export function replayReducer(s: Replay, a: ReplayAction): Replay {
  switch (a.type) {
    case "toggle":
      return { ...s, playing: !s.playing };
    case "speed":
      return { ...s, speed: SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length] };
    case "seek":
      return { ...s, index: Math.max(0, Math.min(a.index, a.n - 1)) };
    case "advance": {
      // playing stops on the last point
      const next = s.index + a.steps;
      return next >= a.n - 1 ? { ...s, index: Math.max(0, a.n - 1), playing: false } : { ...s, index: next };
    }
  }
}
