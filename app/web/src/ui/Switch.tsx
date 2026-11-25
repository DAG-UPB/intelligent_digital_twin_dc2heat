/** An on/off switch (a button with role="switch") with its label on the right. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="switch">
      <span className="switch__track">
        <span className="switch__knob" />
      </span>
      {label}
    </button>
  );
}
