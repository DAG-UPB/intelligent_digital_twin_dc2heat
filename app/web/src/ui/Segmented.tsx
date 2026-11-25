/** A row of mutually exclusive options (a radio group drawn as one control); an option with `disabled` (its reason) cannot be picked.
 * `data-label`: its label as written, for the tours to find it (the aria-label is translated in German). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; disabled?: string | null }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-label={label} className="segmented">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} disabled={!!o.disabled} title={o.disabled ?? undefined} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
