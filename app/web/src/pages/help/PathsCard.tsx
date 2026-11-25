/** The tutorial's start (Help › How to use, on top): the app's tour, then the three paths of paths.ts side by side, a
 * step a line with its page ("Go") and its tour there ("Show me", at the step it is about). */
import { hrefOf } from "../../app/routes";
import { PATHS, type TwinPath } from "./paths";
import { APP_ROUTE, startTourAt } from "./tours";

function PathCard({ p }: { p: TwinPath }) {
  return (
    <article className={`help-path help-path--${p.id}`} aria-label={p.title}>
      <h3 className="help-path__title">{p.title}</h3>
      <p className="help-path__lead">{p.lead}</p>
      <p className="help-path__needs">{p.needs}</p>
      <ol className="help-path__steps">
        {p.steps.map((s) => {
          const [tab, sub] = s.route.split("/");
          return (
            <li key={s.text}>
              <span>{s.text}</span>
              <span className="help-path__go">
                <button type="button" className="btn btn--xs btn--primary" onClick={() => startTourAt({ route: s.route, at: s.at })}>
                  ▶ Show me
                </button>
                <a className="btn btn--xs" href={hrefOf(tab, sub)}>
                  Go
                </a>
              </span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export default function PathsCard() {
  return (
    <section className="card card--lg help-paths" aria-labelledby="paths-title">
      <div className="help-paths__head">
        <h2 id="paths-title" className="help__h2">
          Start here: three paths
        </h2>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => startTourAt({ route: APP_ROUTE, app: true })}>
          ▶ How to get around the app
        </button>
      </div>
      <p className="help-paths__lead">
        The Intelligent Digital Twin is for three things, one after the other: ideation, planning and operation. “Show me” opens the page with a tour of what to
        do there. On any page, the ? at the top right says what the page is for and explains it.
      </p>
      <div className="help-paths__grid">
        {PATHS.map((p) => (
          <PathCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}
