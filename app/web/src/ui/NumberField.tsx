/**
 * A number input in one row with its label and unit; typed values are clamped to min..max, blanks are ignored.
 * `grouped`: shown with thousand separators (12.000) and typed without them; a text box that still reads as a number
 * field to assistive tech and tests (role spinbutton).
 */
import { useState } from "react";
import { LOCALE } from "../lib/format";

const grouping = (v: number) => v.toLocaleString(LOCALE, { maximumFractionDigits: 3 });

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  unit,
  grouped = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  grouped?: boolean;
}) {
  // what is being typed, kept as typed until the field is left (the separators are put back then); the shown text is
  // not changed on focus, so selecting it all and typing over it works
  const [typing, setTyping] = useState<string | null>(null);
  const take = (text: string) => {
    const v = Number(grouped ? text.replace(/\./g, "").replace(",", ".") : text); // as shown: 12.000,5
    if (text.trim() !== "" && Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min, v)));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      {grouped ? (
        <input
          className="field field--sm"
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          value={typing ?? grouping(value)}
          onBlur={() => setTyping(null)}
          onChange={(e) => {
            setTyping(e.target.value);
            take(e.target.value);
          }}
        />
      ) : (
        <input className="field field--sm" type="number" value={value} min={min} max={max} step={step} onChange={(e) => take(e.target.value)} />
      )}
      <span className="number-field__unit">{unit}</span>
    </label>
  );
}
