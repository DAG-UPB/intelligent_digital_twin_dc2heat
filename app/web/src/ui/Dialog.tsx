/**
 * A modal dialog over a dimmed page. Escape or a click on the backdrop closes it; focus moves into it,
 * Tab / Shift+Tab stay inside it, and focus goes back to where it was on close. Rendered on <body>: inside a CSS
 * container (the top bar's tools) a fixed backdrop would be laid out in that box, not over the page.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The controls of the box that can take focus now (hidden ones, e.g. a file input, cannot). */
const focusables = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);

export function Dialog({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (box.current) (focusables(box.current)[0] ?? box.current).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !box.current) return;
      const els = focusables(box.current);
      const inside = box.current.contains(document.activeElement);
      const edge = e.shiftKey ? els[0] : els[els.length - 1];
      // wrap around at the first / last control (or when focus has left the box)
      if (!els.length || !inside || document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? els[els.length - 1] : els[0])?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  return createPortal(
    // mousedown, not click: a text selection dragged out of the box must not close it
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={className ? `dialog ${className}` : "dialog"}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
