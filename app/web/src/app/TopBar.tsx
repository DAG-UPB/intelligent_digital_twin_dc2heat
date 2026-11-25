/**
 * The top bar: brand (the logo, its tooltip the app's name and version, and the Home button), the centred tabs, and
 * the tools (the project, save / open, colours, theme, help). Which data center a page works on is chosen on the page,
 * under the sub-tabs (DataCenterPicker), not here.
 * The brand is the logo and Home; in the middle one track: the whole twin's button (the tab marked `whole`, its name in
 * the colours of the three parts), then the parts it is made of, in the order the heat flows (›), each icon its
 * colour. A raised pill slides under the page's tab. The twin's mark is the project's loop of its three parts (the data
 * center's warm side, the heat distribution in the middle, the homes' cold side); hovering the twin washes the track in
 * their colours, hovering a part fills its tab with its colour and lights its piece of the mark.
 * From 1280 px wide it is one row; the tools stay compact (icon buttons with names for screen readers and tooltips)
 * until their column has room for the Save / Open labels.
 */
import { LANG, setLang } from "../lib/i18n";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { version } from "../../package.json"; // the one place the app version is kept
import { MaskIcon } from "../ui/MaskIcon";
import type { DataVersions } from "../api";
import ConnectAi from "./ConnectAi";
import ProjectButtons from "./ProjectButtons";
import ProjectPicker from "./ProjectPicker";
import { hrefOf, TABS, type TabRoute } from "./routes";
import { otherTheme, PALETTES, usePalette, useThemeToggle } from "./theme";

/** `help`: the "?" at the right end (HelpPop: the page's line, its tour, the app's tour). */
export default function TopBar({ active, project, help }: { active: TabRoute; project: DataVersions | null; help: ReactNode }) {
  const [theme, toggleTheme] = useThemeToggle();
  // one palette now (the swatches gave way to the language button): who had picked another is back on the first
  const [, setPalette] = usePalette();
  useEffect(() => setPalette(PALETTES[0].id), [setPalette]);
  const twin = TABS.find((t) => t.whole);
  // the pill under the page's tab: placed on its button, again when the track changes size (fonts, the window)
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"]');
      setPill(on ? { left: on.offsetLeft, top: on.offsetTop, width: on.offsetWidth, height: on.offsetHeight } : null);
    };
    place();
    const seen = new ResizeObserver(place);
    seen.observe(el);
    return () => seen.disconnect();
  }, [active]);
  const tab = (t: TabRoute) => (
    <button
      key={t.id}
      role="tab"
      aria-selected={t === active}
      className="topbar__tab"
      data-part={t.id}
      onClick={() => (window.location.hash = hrefOf(t.id, t.subs[0].id))}
    >
      {t.icon && <MaskIcon src={t.icon} className="topbar__icon" />}
      {t.label}
    </button>
  );
  return (
    <nav className="topbar" aria-label="Main">
      <span className="topbar__brand">
        <img src={theme === "dark" ? "/dc2heat-light.png" : "/dc2heat.png"} alt="DC2HEAT" height={36} title={`Intelligent Digital Twin · version ${version}`} />
        {/* back to the previous screen (the hash routes are the browser's history), then home */}
        <button type="button" className="btn btn--pill btn--ghost btn--icon topbar__home" onClick={() => window.history.back()} aria-label="Back" title="Back to the previous screen">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <a
          className={`btn btn--pill btn--ghost btn--icon topbar__home${active.id === "home" ? " btn--on" : ""}`}
          href={hrefOf("home", "start")}
          aria-label="Home"
          aria-current={active.id === "home" ? "page" : undefined}
          title="Home"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
          </svg>
        </a>
      </span>
      <div className="topbar__tabs" ref={track}>
        {pill && (
          <span
            className="topbar__pill"
            style={{ width: pill.width, height: pill.height, transform: `translate(${pill.left}px, ${pill.top}px)` }}
            aria-hidden
          />
        )}
        {twin && (
          <button
            type="button"
            className={`topbar__twin${active === twin ? " topbar__twin--on" : ""}`}
            aria-current={active === twin ? "page" : undefined}
            title="The whole twin: made of the Data Center, the Heat Distribution and the District"
            onClick={() => (window.location.hash = hrefOf(twin.id, twin.subs[0].id))}
          >
            {/* the twin's mark, the project's loop: the data center's warm arrow (red), the heat distribution in the middle
                (the circle), the district's cold arrow (blue); a part's piece lights up while its tab is hovered */}
            <svg className="topbar__mark" viewBox="0 0 32 32" width="28" height="28" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <g className="topbar__mark-dc">
                <path d="M11.9 27.3A12 12 0 0 1 11.9 4.7M8.7 2.9 11.9 4.7 9.9 7.9" strokeWidth="2.2" />
              </g>
              <g className="topbar__mark-heat">
                <circle cx="16" cy="16" r="5" strokeWidth="2" />
              </g>
              <g className="topbar__mark-district">
                <path d="M20.1 4.7A12 12 0 0 1 20.1 27.3M23.3 29.1 20.1 27.3 22.1 24.1" strokeWidth="2.2" />
              </g>
            </svg>
            <span className="topbar__twin-name">{twin.label}</span>
          </button>
        )}
        <span className="topbar__divide" aria-hidden />
        <span role="tablist" aria-label="Parts of the twin" className="topbar__parts">
          {TABS.filter((t) => !t.whole).map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 && (
                <span className="topbar__flow" aria-hidden>
                  ›
                </span>
              )}
              {tab(t)}
            </Fragment>
          ))}
        </span>
      </div>
      <div className="topbar__tools">
        <ConnectAi />
        {/* the project and its file, as one: the picker with Save and Open beside it */}
        <span className="topbar__project-group" role="group" aria-label="Project and its file">
          <ProjectPicker project={project} />
          <ProjectButtons />
        </span>
        {/* German or English (lib/i18n.ts): the page loads again in the other */}
        <button
          type="button"
          className="btn btn--pill btn--ghost topbar__lang"
          onClick={() => setLang(LANG === "de" ? "en" : "de")}
          aria-label={LANG === "de" ? "Sprache: Deutsch (auf Englisch umschalten)" : "Language: English (switch to German)"}
          title={LANG === "de" ? "English" : "Deutsch"}
          translate="no"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
          </svg>
          <span className="topbar__lang-code">{LANG === "de" ? "DE" : "EN"}</span>
        </button>
        <button
          className="btn btn--pill btn--ghost btn--icon"
          onClick={toggleTheme}
          aria-label={`Switch to ${otherTheme(theme)} mode`}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        {help}
      </div>
    </nav>
  );
}
