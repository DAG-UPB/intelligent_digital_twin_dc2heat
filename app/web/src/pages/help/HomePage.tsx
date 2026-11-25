/**
 * Home, the landing page (the default route): what the app is and why (the problem, the twin), the whole twin's pages
 * on top of the system figure, each part's pages under its box, then the project, where to start and the
 * documentation. Built from the help pages' pieces.
 */
import { hrefOf, TABS } from "../../app/routes";
import { SUB_ICONS } from "../../app/SubIcon";
import { PAGE_TEXT } from "./home";
import { SystemFigure } from "./SystemFigure";
import "./help.css";

const TWIN = TABS.find((t) => t.whole)!;

/** A link to one page, its description under it on hover and on keyboard focus. */
function PageLink({ tab, sub, label }: { tab: string; sub: string; label: string }) {
  const tip = `tip-${tab}-${sub}`;
  return (
    <a className="btn btn--pill home__part-link" href={hrefOf(tab, sub)} aria-label={`Go to ${label}`} aria-describedby={tip}>
      {SUB_ICONS[`${tab}/${sub}`]}
      {label} <span aria-hidden>→</span>
      <span role="tooltip" id={tip} className="home__tip">
        {PAGE_TEXT[`${tab}/${sub}`]}
      </span>
    </a>
  );
}

export default function HomePage() {
  return (
    <div className="page help home">
      <header className="help__hero">
        <h1 className="page__title help__title">Intelligent Digital Twin</h1>
      </header>

      <section className="card card--lg home__sketch">
        {/* the whole twin: a frame round the figure and the parts' pages, its own name and pages at the foot */}
        <div className="home__frame">
          {/* on top: the whole twin, the frame around all three, what it is and its pages */}
          <nav className="home__twin" aria-label={`${TWIN.label}: its pages`} data-part="twin">
            <span className="home__twin-name">
              <img src="/twin-mark.svg" alt="" /> {TWIN.label}
            </span>
          </nav>
          <SystemFigure />
          {/* each part's pages, right under its box (the figure's columns) */}
          <nav className="home__part-links" aria-label="The parts' pages">
            {TABS.filter((t) => !t.whole).map((tab) => (
              <div key={tab.id} data-part={tab.id}>
                {tab.subs.map((s) => (
                  <PageLink key={s.id} tab={tab.id} sub={s.id} label={s.label} />
                ))}
              </div>
            ))}
          </nav>
        </div>
      </section>

      {/* at the bottom: the project, where to start, and the documentation */}
      <div className="home__bottom">
        <section className="card card--lg">
          <h2 className="help__h2">The DC2HEAT project</h2>
          <p>DC2HEAT brings the waste heat of data centers into district heating. Its website has more about the project.</p>
          <div className="help-section__links">
            <a className="btn btn--pill btn--primary" href="https://dc2heat.de/" target="_blank" rel="noreferrer">
              Visit dc2heat.de <span aria-hidden>↗</span>
            </a>
          </div>
        </section>
        <section className="card card--lg">
          <h2 className="help__h2">New here?</h2>
          <p>
            Pick a case in the <b>Case</b> menu, right of the page tabs: <b>Case 1</b> is the example, a 5 MW data center in the European Central Bank&apos;s
            building with the district around it and its models; <b>Blank</b> starts from scratch. Then start the tutorial: three paths, ideation, planning and
            operation. On every page, <b>?</b> at the top right says what the page is for and shows it step by step.
          </p>
          <div className="help-section__links">
            <a className="btn btn--pill btn--primary" href={hrefOf("help", "guide")}>
              Start the tutorial
            </a>
          </div>
        </section>
        <section className="card card--lg help-docs" aria-labelledby="home-more">
          <div>
            <h2 id="home-more" className="help__h2">
              Technical documentation and API
            </h2>
            <p>
              How the models, the physics equations and the heat balance work, with the code behind them, and the reference of the app's HTTP API. Both open in
              a new tab.
            </p>
          </div>
          <div className="help-section__links">
            <a className="btn btn--pill btn--primary" href="/docs/" target="_blank" rel="noreferrer">
              Technical documentation <span aria-hidden>↗</span>
            </a>
            <a className="btn btn--pill" href="/api/docs" target="_blank" rel="noreferrer">
              API reference <span aria-hidden>↗</span>
            </a>
            <a className="btn btn--pill" href="#/help/assistant">
              AI assistant (MCP)
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
