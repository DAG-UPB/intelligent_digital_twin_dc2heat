/** A range slider with its label on the left and the current value (formatted by the caller) on the right. */
import type { ReactNode } from "react";

export function Slider({
  label,
  value,
  show,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: ReactNode;
  value: number;
  show?: ReactNode; // the value as shown; `value` when not given
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <span className="mono slider__value">{show ?? value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}
