/**
 * Zoom, fit and lock in the corner of the drawing. Locked, nothing moves: no zoom, no pan, no dragging of
 * instruments or shapes, no dropping of variables; a click only selects, as on a picture you look at.
 */
interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  fitted: boolean; // the whole drawing is shown, centred
  locked: boolean;
  onLock: (on: boolean) => void;
  selecting: boolean; // a drag on the drawing draws a selection box (else it pans; Shift+drag selects too)
  onSelecting: (on: boolean) => void;
}

export function ViewControls(p: Props) {
  return (
    <div className="pid-zoom" role="group" aria-label="View">
      <button
        type="button"
        className="btn btn--sm"
        onClick={p.onZoomOut}
        disabled={p.zoom <= 1 || p.locked}
        aria-label="Zoom out"
        title="Zoom out (or the mouse wheel over the drawing)"
      >
        −
      </button>
      <span className="pid-zoom__pct" aria-live="polite">
        {Math.round(p.zoom * 100)}%
      </span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={p.onZoomIn}
        disabled={p.locked}
        aria-label="Zoom in"
        title="Zoom in (or the mouse wheel over the drawing)"
      >
        +
      </button>
      <button type="button" className="btn btn--sm" onClick={p.onFit} disabled={p.fitted || p.locked} title="Show the whole drawing">
        Fit
      </button>
      <button
        type="button"
        className={p.selecting ? "btn btn--sm btn--primary" : "btn btn--sm"}
        aria-pressed={p.selecting}
        onClick={() => p.onSelecting(!p.selecting)}
        title="Select several variables: drag a box around them (or hold Shift and drag, or Shift-click them)"
      >
        Select
      </button>
      <button
        type="button"
        className={p.locked ? "btn btn--sm btn--primary" : "btn btn--sm"}
        aria-pressed={p.locked}
        onClick={() => p.onLock(!p.locked)}
        title={p.locked ? "Unlock: zoom, pan and move instruments and shapes again" : "Lock: nothing moves (no zoom, pan or drag); a click still selects"}
      >
        {p.locked ? "Locked" : "Lock"}
      </button>
    </div>
  );
}
