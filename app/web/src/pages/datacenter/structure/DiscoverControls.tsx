/**
 * "Causal discovery" (TempCaFe, Temporal Causal Feature Selection, the project's framework): one button that opens a
 * small menu with the method (PCMCI or PC), the significance level, the lag range (min 1..max, max min..24) and the
 * start: refine the drawn graph (only its links are tested, their lags learnt) or blind (every pair of the shown
 * variables with data, no drawn link as prior). Run starts it; Escape or a click elsewhere closes the menu.
 */
import { useEffect, useRef, useState } from "react";

export interface DiscoverOptions {
  method: "pcmci" | "pc";
  minLag: number;
  maxLag: number;
  alpha: number;
  prior: "graph" | "none"; // refine the drawn links, or blind from no links
}

const ALPHAS = [0.001, 0.01, 0.05, 0.1];

export function DiscoverControls({ busy, onDiscover }: { busy: boolean; onDiscover: (o: DiscoverOptions) => void }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<DiscoverOptions["method"]>("pcmci");
  const [minLag, setMinLag] = useState(1);
  const [maxLag, setMaxLag] = useState(5);
  const [alpha, setAlpha] = useState(0.01);
  const [prior, setPrior] = useState<DiscoverOptions["prior"]>("graph");
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = () => {
    setOpen(false);
    onDiscover({ method, minLag, maxLag, alpha, prior });
  };

  return (
    <span className="pid-vars__drop" ref={box}>
      <button
        ref={btn}
        type="button"
        className={open ? "btn btn--on" : "btn"}
        onClick={() => setOpen(!open)}
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {busy ? "Causal discovery running…" : "Causal discovery"}
      </button>
      {open && (
        <div className="pid-vars__pop" role="dialog" aria-label="Causal discovery">
          <span className="muted">
            TempCaFe (Temporal Causal Feature Selection) tests in the data which time lags carry each link's influence. Links with no evidence are drawn dashed;
            the found lags and their strengths go to the inspector. It only suggests: nothing is written until you save.
          </span>
          <span className="pid-group" role="radiogroup" aria-label="Start from">
            <label>
              <input type="radio" name="discover-prior" checked={prior === "graph"} onChange={() => setPrior("graph")} /> Refine the drawn graph
            </label>
            <label>
              <input type="radio" name="discover-prior" checked={prior === "none"} onChange={() => setPrior("none")} /> Blind, no links
            </label>
          </span>
          <label className="pid-group">
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as DiscoverOptions["method"])} className="field field--sm">
              <option value="pcmci">PCMCI</option>
              <option value="pc">PC</option>
            </select>
          </label>
          <label className="pid-group">
            Significance level (alpha)
            <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="field field--sm">
              {ALPHAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <span className="pid-group">
            <label className="pid-group">
              Lags from
              <input
                type="number"
                min={1}
                max={maxLag}
                value={minLag}
                onChange={(e) => setMinLag(Math.max(1, Math.min(maxLag, Number(e.target.value) || 1)))}
                className="field field--sm"
                style={{ width: 56 }}
                aria-label="Smallest lag"
              />
            </label>
            <label className="pid-group">
              to
              <input
                type="number"
                min={minLag}
                max={24}
                value={maxLag}
                onChange={(e) => setMaxLag(Math.max(minLag, Math.min(24, Number(e.target.value) || 1)))}
                className="field field--sm"
                style={{ width: 56 }}
                aria-label="Largest lag"
              />
            </label>
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={run}>
            Run
          </button>
        </div>
      )}
    </span>
  );
}
