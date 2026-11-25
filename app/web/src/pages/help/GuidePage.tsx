/** Help > "How to use": the tutorial's three paths on top (PathsCard), then every page in detail (the steps are data in guide.ts). */
import { DocsCard } from "./DocsCard";
import { GUIDE } from "./guide";
import { GuideStepCard } from "./GuideStepCard";
import PathsCard from "./PathsCard";
import "./help.css";

/** Scrolls to a step; buttons, not #anchors, because the location hash is the page route. */
const jumpTo = (n: number) => document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

export default function GuidePage() {
  return (
    <div className="page help">
      <header className="help__hero">
        <h1 className="page__title help__title">How to use</h1>
        <p className="help__lead">Start with one of the three paths. Under them, every page in detail, in the order most people use the app.</p>
      </header>
      <PathsCard />
      <h2 className="help__h2">Every page in detail</h2>
      <nav className="card help-steps" aria-label="Steps">
        <ol>
          {GUIDE.map((s, i) => (
            <li key={s.title}>
              <button type="button" className="btn btn--ghost btn--pill" onClick={() => jumpTo(i + 1)}>
                <span className="help-steps__num">{i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {GUIDE.map((s, i) => (
        <GuideStepCard key={s.title} n={i + 1} step={s} />
      ))}
      <DocsCard />
    </div>
  );
}
