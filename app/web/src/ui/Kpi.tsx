/**
 * A key figure: caption, big number with unit, an optional 0..100 % bar and a line below.
 * The tone colours the number, or with `edge` a top border instead (the number stays in the text colour).
 * `delta`: a line for the change against a reference (a scenario's against the run without it).
 * With `info` the tile is a button that opens more about it in a box. KpiRow: a row of them, the first `max` (5) shown and the others under "More figures", in a panel under the row.
 */
import { Children, useId, useState, type CSSProperties, type ReactNode } from "react";

export function Kpi({
  label,
  value,
  unit,
  sub,
  tone = "var(--foreground)",
  bar,
  edge,
  hint,
  info,
  delta,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: string;
  bar?: number;
  edge?: boolean;
  hint?: string;
  delta?: string;
  info?: ReactNode; // more about it in a box that opens on a click (a native popover: Esc or a click outside closes it)
}) {
  const id = useId();
  const style = { "--kpi-tone": tone, ...(edge ? { borderTopColor: tone } : {}) } as CSSProperties;
  const body = (
    <>
      <span className="caps kpi__label">{label}</span>
      <span className="mono kpi__value" style={edge ? undefined : { color: tone }}>
        {value}
        {unit && <span className="kpi__unit">{unit}</span>}
      </span>
      {bar !== undefined && (
        <span className="kpi__bar">
          <span style={{ width: `${Math.min(100, Math.max(0, bar))}%`, background: tone }} />
        </span>
      )}
      {sub && <span className="kpi__sub">{sub}</span>}
      {delta && <span className="kpi__delta">{delta}</span>}
    </>
  );
  const cls = `card kpi${edge ? " kpi--edge" : ""}`;
  // the tone: also the tile's glow (look.css)
  if (!info)
    return (
      <div className={cls} style={style} title={hint}>
        {body}
      </div>
    );
  return (
    <>
      <button type="button" className={`${cls} kpi--info`} style={style} title={hint} popoverTarget={id}>
        {body}
      </button>
      <div popover="auto" id={id} className="card kpi-info" role="dialog" aria-label={label}>
        <div className="kpi-info__head">
          <span className="caps">{label}</span>
          <button type="button" className="btn btn--ghost btn--xs" popoverTarget={id} popoverTargetAction="hide" aria-label="Close">
            ×
          </button>
        </div>
        {info}
      </div>
    </>
  );
}

/**
 * A row of KPIs (`className` its layout): `max` shown, the others behind a small button at the row's end, which opens
 * them in a panel under the row with `detail` (more specific information) under them; label: the group's name.
 */
export function KpiRow({ className, label, max = 5, more = "More figures", detail, fold, open: shown, children }: { className: string; label?: string; max?: number; more?: string; detail?: ReactNode; fold?: string; open?: boolean; children: ReactNode }) {
  const all = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const extra = all.length > max || !!detail;
  const count = all.length > max ? ` (${all.length - max})` : "";
  // open: shown or not as the page says (its own tab, no button here); the panel after the row
  if (shown !== undefined)
    return (
      <div className="kpi-group kpi-group--ctl" aria-label={label}>
        <div className={className}>{all.slice(0, max)}</div>
        <div className="kpi-more__panel kpi-more__panel--ctl" hidden={!shown || !extra}>
          {all.length > max && <div className={className}>{all.slice(max)}</div>}
          {detail}
        </div>
      </div>
    );
  // fold: the others a folded line under the row (class `fold`), as the card's other folded parts
  if (fold)
    return (
      <div className="kpi-group kpi-group--fold" aria-label={label}>
        <div className={className}>{all.slice(0, max)}</div>
        {extra && (
          <details className={fold}>
            <summary>
              {more}
              {count}
            </summary>
            {all.length > max && <div className={className}>{all.slice(max)}</div>}
            {detail}
          </details>
        )}
      </div>
    );
  return (
    <div className="kpi-group" aria-label={label}>
      <div className={className}>{all.slice(0, max)}</div>
      {extra && (
        <button type="button" className="kpi-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {more}
          {all.length > max ? ` (${all.length - max})` : ""}
        </button>
      )}
      {extra && (
        <div className="kpi-more__panel" hidden={!open}>
          {all.length > max && <div className={className}>{all.slice(max)}</div>}
          {detail}
        </div>
      )}
    </div>
  );
}
