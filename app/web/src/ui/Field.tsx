/**
 * A form control with its caption above it. The caption is the control's whole accessible name
 * (aria-labelledby): a wrapping <label> alone would also read out a select's chosen option.
 */
import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

export function Field({ label, children }: { label: ReactNode; children: ReactElement<{ "aria-labelledby"?: string }> }) {
  const id = useId();
  return (
    <label className="field-label">
      <span id={id} className="caps">
        {label}
      </span>
      {cloneElement(children, { "aria-labelledby": id })}
    </label>
  );
}
