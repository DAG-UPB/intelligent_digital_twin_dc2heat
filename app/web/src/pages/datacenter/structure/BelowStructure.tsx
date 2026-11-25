/**
 * What comes under a structure (PidPage `model`): the page that models it, whole (the data center's AI modelling, the
 * heat distribution's Components), with its own causal graph pinned at the top left while scrolling. It is loaded
 * only once the user scrolls near it: AI modelling evaluates the trained models when it opens. `open`: loaded at once
 * (e.g. a building handed over from the Site map, whose profile scrolls itself into view).
 */
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

export function BelowStructure({ label, open = false, children }: { label: string; open?: boolean; children: ReactNode }) {
  const mark = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(open);
  useEffect(() => {
    const el = mark.current;
    if (!el || near) return;
    const seen = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "200px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [near]);
  return (
    <section className="pid-below" aria-label={label} ref={mark}>
      {near ? (
        <Suspense fallback={<p className="muted pid-below__wait">Loading {label}…</p>}>{children}</Suspense>
      ) : (
        <p className="muted pid-below__wait">{label} below: scroll on.</p>
      )}
    </section>
  );
}
