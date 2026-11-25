/**
 * One variable dropped on another: what they are to each other. "=" (the same variable: the one with data takes the
 * other's place, shown under its name) or their mean, sum, min or max (a group, as Group… makes); Cancel puts the
 * dragged one back. A small menu at the drop, closed by Escape too.
 */
import { useEffect } from "react";
import { GROUP_METHODS } from "./notes";

interface Props {
  v: string; // the one dragged
  onto: string; // the one it was dropped on
  at: { left: number; top: number }; // on screen (the drop)
  same: string | null; // why "=" is not possible, or null
  onSame: () => void;
  onGroup: (method: (typeof GROUP_METHODS)[number]) => void;
  onCancel: () => void;
}

export function DropMenu({ v, onto, at, same, onSame, onGroup, onCancel }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="card pid-drop" role="menu" aria-label={`${v} on ${onto}`} style={{ left: at.left, top: at.top }}>
      <div className="pid-drop__head">
        <b>{v}</b> on <b>{onto}</b>
      </div>
      <button type="button" role="menuitem" className="btn btn--sm" disabled={!!same} title={same ?? `${v} and ${onto} are the same variable`} onClick={onSame}>
        = the same
      </button>
      {GROUP_METHODS.map((m) => (
        <button key={m} type="button" role="menuitem" className="btn btn--sm" title={`A new variable: the ${m} of both`} onClick={() => onGroup(m)}>
          {m} of both
        </button>
      ))}
      <button type="button" role="menuitem" className="btn btn--sm pid-drop__cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
