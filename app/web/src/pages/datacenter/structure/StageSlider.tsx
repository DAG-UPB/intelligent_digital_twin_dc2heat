/** The P&ID -> causal graph slider, with a band for "graph in place" and clickable stage labels under it. */
import { CIRCLE_FROM, FADE_END, STOPS } from "./geometry";

export function StageSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="pid-stage">
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Fade P&ID into causal links" />
      <div className="pid-stage__band" style={{ left: `${FADE_END * 100}%`, width: `${(CIRCLE_FROM - FADE_END) * 100}%` }} />
      {STOPS.map((stop) => (
        <button
          key={stop.label}
          type="button"
          className="pid-stage__stop"
          aria-pressed={Math.abs(value - stop.at) < 0.08}
          onClick={() => onChange(stop.at)}
          style={{ left: `${stop.at * 100}%`, transform: `translateX(${stop.at === 0 ? "0" : stop.at === 1 ? "-100%" : "-50%"})` }}
        >
          {stop.label}
        </button>
      ))}
    </div>
  );
}
