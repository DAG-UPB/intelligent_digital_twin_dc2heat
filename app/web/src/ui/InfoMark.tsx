/** An ⓘ that says what a term means: a click (or Enter) opens the text under it, a second click or Escape closes it.
 * `hover`: it also opens while the pointer is on it (a short help in place of a paragraph); `mark`: its sign (e.g. "?"); `text`: a string, or lines of their own (a calculation). */
import { useState, type ReactNode } from "react";

export function InfoMark({ term, text, hover, mark = "ⓘ" }: { term: string; text: ReactNode; hover?: boolean; mark?: string }) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <span className="info-mark" onMouseEnter={hover ? () => setOver(true) : undefined} onMouseLeave={hover ? () => setOver(false) : undefined}>
      <button
        type="button"
        className={mark === "ⓘ" ? "info-mark__btn" : "info-mark__btn info-mark__btn--q"}
        aria-expanded={open || over}
        aria-label={`What ${term} means`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {mark}
      </button>
      {(open || over) && (
        <span className="info-mark__pop" role="note">
          {text}
        </span>
      )}
    </span>
  );
}
