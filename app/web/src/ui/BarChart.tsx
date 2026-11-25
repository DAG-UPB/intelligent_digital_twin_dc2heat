/**
 * Grouped bars (plain HTML and CSS): a few bars per group (the same series in every group, one legend), a zero line,
 * negative values below it. Each bar's value is written on it when there is room (`values`), always in its title.
 * With `onPick` a group is a button (e.g. a scenario or a month to look at), `picked` marks one.
 */
export interface Bar {
  label: string;
  value: number;
  color: string;
  text: string; // the value as shown
}

export function BarChart({
  label,
  groups,
  height = 170,
  values = true,
  picked,
  onPick,
}: {
  label: string;
  groups: { label: string; bars: Bar[] }[];
  height?: number;
  values?: boolean;
  picked?: number;
  onPick?: (i: number) => void;
}) {
  const all = groups.flatMap((g) => g.bars.map((b) => b.value));
  const pad = (Math.max(0, ...all) - Math.min(0, ...all)) * 0.15; // room past the longest bar for its value
  const hi = Math.max(0, ...all.map((v) => v + pad));
  const lo = Math.min(0, ...all.map((v) => v - pad));
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100; // % from the bottom
  return (
    <figure className="bars" aria-label={label}>
      <div className="bars__legend">
        {(groups[0]?.bars ?? []).map((b) => (
          <span key={b.label}>
            <i style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
      <div className="bars__plot" style={{ height }}>
        <div className="bars__zero" style={{ bottom: `${zero}%` }} />
        {groups.map((g, i) => (
          <button
            type="button"
            key={g.label}
            className={i === picked ? "bars__group bars__group--on" : "bars__group"}
            onClick={onPick && (() => onPick(i))}
            disabled={!onPick}
            aria-label={`${g.label}: ${g.bars.map((b) => `${b.label} ${b.text}`).join(", ")}`}
          >
            {g.bars.map((b) => {
              const h = (Math.abs(b.value) / span) * 100;
              return (
                <span key={b.label} className="bars__slot">
                  <span
                    className="bars__bar"
                    style={{
                      bottom: `${b.value < 0 ? zero - h : zero}%`,
                      height: `${h}%`,
                      background: b.color,
                    }}
                    title={`${g.label} · ${b.label}: ${b.text}`}
                  >
                    {values && <span className={b.value < 0 ? "bars__val bars__val--neg" : "bars__val"}>{b.text}</span>}
                  </span>
                </span>
              );
            })}
          </button>
        ))}
      </div>
      <div className="bars__labels">
        {groups.map((g) => (
          <span key={g.label}>{g.label}</span>
        ))}
      </div>
    </figure>
  );
}
