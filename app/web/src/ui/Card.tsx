/** Panels: Card (a raised box, optionally titled with a colour tone) and Section (a titled block under a rule). */
import type { CSSProperties, ReactNode } from "react";

/** A raised panel. With `title`, the title is a caption on top; `tone` adds a coloured top edge and dot. */
export function Card({ title, tone, large, className, style, children }: { title?: ReactNode; tone?: string; large?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  const cls = ["card", large && "card--lg", title != null && "card--titled", className].filter(Boolean).join(" ");
  return (
    <section className={cls} style={tone ? { borderTop: `3px solid ${tone}`, ...style } : style}>
      {title != null && (
        <div className="caps card__title">
          {tone && <span className="card__dot" style={{ background: tone }} />}
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

/** A titled block inside a card or side panel, separated from what is above by a line. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <span className="caps">{title}</span>
      {children}
    </div>
  );
}
