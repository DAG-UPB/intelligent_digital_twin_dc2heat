/**
 * The top bar's "?": a box with what the open page is for (one line, pages/help/home.ts), "Explain this page" (its
 * tour, where it has one), "How to get around the app" (the app's tour) and the way to the tutorial and the help. A
 * click outside or Esc closes it.
 */
import { useEffect, useRef, useState } from "react";
import { PAGE_TEXT } from "../pages/help/home";
import { hrefOf } from "./routes";

/** The pages without a line on Home: Home itself and the help. */
const OTHER: Record<string, string> = {
  "home/start": "The start: what the app is, the three parts of the twin and their pages.",
  "help/about": "What the app is and what it is for.",
  "help/guide": "The tutorial: three paths (ideation, planning, operation), step by step, and every page in detail.",
  "help/assistant": "How to connect an AI assistant that works with you on the open page.",
};

export default function HelpPop({ route, name, onTour, onAppTour }: { route: string; name: string; onTour?: () => void; onAppTour: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => setOpen(false), [route]);
  const run = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  return (
    <span ref={box} className="help-pop">
      <button
        type="button"
        className={`btn btn--pill btn--ghost btn--icon topbar__help${open ? " btn--on" : ""}`}
        aria-label="Help"
        aria-expanded={open}
        title="Help: this page, its tour, the tutorial"
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      {open && (
        <div className="help-pop__box" role="dialog" aria-label="Help on this page">
          <b className="help-pop__name">{name}</b>
          <p className="help-pop__text">{PAGE_TEXT[route] ?? OTHER[route] ?? ""}</p>
          <div className="help-pop__buttons">
            {onTour && (
              <button type="button" className="btn btn--sm btn--primary" onClick={run(onTour)}>
                ▶ Explain this page
              </button>
            )}
            <button type="button" className="btn btn--sm" onClick={run(onAppTour)}>
              ▶ How to get around the app
            </button>
          </div>
          <div className="help-pop__links">
            <a href={hrefOf("help", "guide")} onClick={() => setOpen(false)}>
              Tutorial
            </a>
            <a href={hrefOf("help", "about")} onClick={() => setOpen(false)}>
              What is this?
            </a>
          </div>
        </div>
      )}
    </span>
  );
}
