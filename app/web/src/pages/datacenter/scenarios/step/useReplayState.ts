/** Replay player: playhead, play/pause and speed, advanced by a requestAnimationFrame loop while playing. */
import { useCallback, useEffect, useReducer } from "react";
import { initialReplay, replayReducer } from "./replay";

export function useReplayState(totalPoints: number) {
  const [s, dispatch] = useReducer(replayReducer, initialReplay);

  useEffect(() => {
    if (!s.playing || totalPoints === 0) return;
    let last = performance.now();
    let acc = 0; // fractional steps carried to the next frame
    let raf = requestAnimationFrame(function animate(now: number) {
      acc += ((now - last) / 1000) * s.speed;
      last = now;
      const steps = Math.floor(acc);
      if (steps > 0) {
        acc -= steps;
        dispatch({ type: "advance", steps, n: totalPoints });
      }
      raf = requestAnimationFrame(animate);
    });
    return () => cancelAnimationFrame(raf);
  }, [s.playing, s.speed, totalPoints]);

  return {
    playheadIndex: s.index,
    isPlaying: s.playing,
    playbackSpeed: s.speed,
    togglePlay: useCallback(() => dispatch({ type: "toggle" }), []),
    cycleSpeed: useCallback(() => dispatch({ type: "speed" }), []),
    seek: useCallback((index: number) => dispatch({ type: "seek", index, n: totalPoints }), [totalPoints]),
  };
}
