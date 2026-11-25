/** The app shell: top bar, the active tab's sub-tabs (none on the landing page), and the one page the hash route points to. */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from "react";
import { answerRequest, CLIENT_ID, fetchDataVersions, openLiveEvents, type DataVersions } from "../api";
import { clearCache } from "../api/http";
import { DATASET, datasetAfterSwitch, datasetOf, enterProject, openDataset } from "../dataset";
import { AGENT_CHANGED, claimFocus, effectOf, hasUnsaved, isPageChange, PAGE_CHANGED, PageActive, reportShell } from "../lib/live";
import { handleRequest } from "./assistant";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Tour, type TourStep } from "../ui/Tour";
import { keepTourAsk, takeTourAsk, TOUR_CASE, TOUR_KEY, tourOf, TOURS, type TourAsk } from "../pages/help/tours";
import { applyCase, caseIsOn } from "./DataCenterPicker";
import HelpPop from "./HelpPop";
import DataCenterPicker from "./DataCenterPicker";
import { hrefOf, resolveRoute } from "./routes";
import TopBar from "./TopBar";
import { SUB_ICONS } from "./SubIcon";
import { mayLeave } from "./leaveGuard";

/** A page loaded when first opened. After an update its file has a new name, so a tab opened before it asks for one
 * that is gone: main.tsx reloads the tab once for the new build (lib/staleBuild.ts), for this file and the ones a
 * page loads itself (Modelling's TrainPage). */
const LOADS: (() => Promise<unknown>)[] = []; // every page's code, fetched ahead once the first page is up (App)
function page(load: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> {
  LOADS.push(load);
  return lazy(load);
}

/**
 * The page of each "tab/sub" route (routes.ts). Only the active one is mounted: switching loses page state, except
 * Planning (KEPT): mounted out of sight while the Site map is open, so it has run when it is opened.
 * Pages load lazily, so a page whose code fails to load or render breaks only itself (see ErrorBoundary).
 */
const PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  "twin/map": page(() => import("../pages/district/SitePage")),
  "district/dashboard": page(() => import("../pages/district/DistrictDashboardPage")),
  "district/structure": page(() => import("../pages/district/structure/DistrictStructurePage")),
  "heat/dashboard": page(() => import("../pages/heat/HeatDashboardPage")),
  "heat/structure": page(() => import("../pages/heat/structure/HeatStructurePage")),
  "twin/matching": page(() => import("../pages/twin/HeatDistributionPage")),
  "twin/planning": page(() => import("../pages/twin/PlanningPage")),
  "dc/dashboard": page(() => import("../pages/datacenter/dashboard/DashboardPage")),
  "dc/pid": page(() => import("../pages/datacenter/structure/DataCenterStructurePage")),
  "home/start": page(() => import("../pages/help/HomePage")),
  "help/about": page(() => import("../pages/help/AboutPage")),
  "help/guide": page(() => import("../pages/help/GuidePage")),
  "help/assistant": page(() => import("../pages/help/AssistantPage")),
};

/** Planning (Heat Matching: the data center's free run, the district's, the matching) takes a while to open: it is
 * mounted out of sight beside the Site map (KEPT_BESIDE), and stays mounted while those two are switched between.
 * Only on the same data center: every module reads the one open DATASET. */
const KEPT = "twin/matching";
const KEPT_BESIDE = "twin/map";

/** A note from the live link: the assistant's message, or a change that waits for the user's unsaved edits. */
type Notice = { text: string; reload?: boolean };

/**
 * Working live with an assistant (lib/live.ts): someone else's save refreshes the open page (remounts it, so it
 * re-reads its data) unless it has unsaved edits; the assistant's requests for this tab are carried out and answered
 * (app/assistant.ts). Returns the page's revision (its key) and the note to show.
 */
function useLive(route: string, dataset: string): [number, Notice | null, (n: Notice | null) => void] {
  const [rev, setRev] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const focus = () => claimFocus();
    window.addEventListener("focus", focus);
    window.addEventListener("blur", focus);
    const close = openLiveEvents((e) => {
      if (e.type === "request") {
        if (e.target && e.target !== CLIENT_ID) return; // for the tab the user works in
        handleRequest(e.action, e.args, (text) => setNotice({ text: `Assistant: ${text}` }))
          .then(async ({ after, ...answer }) => {
            await answerRequest(e.id, answer);
            after?.();
          })
          .catch((err: Error) => answerRequest(e.id, { ok: false, error: err.message }).catch(() => undefined));
        return;
      }
      if (e.type === "agent") return void window.dispatchEvent(new CustomEvent(AGENT_CHANGED, { detail: e.connected })); // Connect AI shows it
      clearCache(); // someone else's change: read again what was kept
      if (isPageChange(e)) return void window.dispatchEvent(new CustomEvent(PAGE_CHANGED, { detail: e.path })); // the page updates itself
      const effect = effectOf(e, DATASET);
      if (!effect) return;
      if (hasUnsaved())
        setNotice({ text: "The assistant saved changes to this data center. Save or discard your edits, then reload to see them.", reload: true });
      else if (effect === "reload") window.location.reload();
      else setRev((r) => r + 1);
    }, claimFocus); // listening (again): report the screen, a report before counts for nothing
    return () => {
      close();
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", focus);
    };
  }, []);
  useEffect(() => reportShell({ route, dataset }), [route, dataset]);
  return [rev, notice, setNotice];
}

export default function App() {
  const [{ tab, sub }, setRoute] = useState(() => resolveRoute(window.location.hash));
  // the other pages' code fetched while the first one is read: a page opened later waits only for its data
  useEffect(() => {
    const t = window.setTimeout(() => LOADS.forEach((load) => load().catch(() => {})), 2000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      if (!mayLeave(window.location.hash)) return window.history.replaceState(null, "", e.oldURL); // the page asks first
      setRoute(resolveRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // the project (data folder version) and its data centers, fetched once: the pickers and the page's dataset use it
  const [project, setProject] = useState<DataVersions | null>(null);
  useEffect(() => {
    fetchDataVersions()
      .then((v) => {
        if (enterProject(v.current, v.folders[v.current] ?? [])) return window.location.reload(); // picks of another project
        setProject(v);
        reportShell({ data_version: v.current });
      })
      .catch(() => undefined);
  }, []);

  const route = `${tab.id}/${sub.id}`;
  const [picks, repick] = useState(0); // a system's dataset chosen under the sub-tabs: render the page again on it
  const wanted = datasetOf(route);
  // one the project does not have (remembered from another project): its first instead
  const dataset = project
    ? datasetAfterSwitch(
        (project.folders[project.current] ?? []).map((d) => d.id),
        wanted,
      )
    : wanted;
  openDataset(dataset); // before the page renders: every module reads the page's data center from DATASET
  const ownData = tab.id !== "home" && tab.id !== "help";
  const [rev, notice, setNotice] = useLive(route, dataset);
  // the pages mounted: the route's (resolveRoute only returns routes of TABS / HOME / HELP, which all have a page), and
  // Planning beside the Site map when it opens on the same data center
  const ids = (project?.folders[project.current] ?? []).map((d) => d.id);
  const keptDataset = project ? datasetAfterSwitch(ids, datasetOf(KEPT)) : datasetOf(KEPT);
  const mounted = (route === KEPT_BESIDE || route === KEPT) && keptDataset === dataset ? [KEPT_BESIDE, KEPT].filter((r) => r === route || r === KEPT) : [route];
  // a tour: the page's ("?" › Explain this page) or the app's, or asked for by a link that opened the page (startTourAt);
  // shown on Case 1: put on first when another case is, then the page loaded again to start it. One through the app
  // (its steps open their pages) stays when the page changes; a page's ends with it.
  const [tour, setTour] = useState<{ name: string; steps: TourStep[]; start: number; roams: boolean } | null>(null);
  const begin = (ask: TourAsk) => {
    const t = tourOf(ask);
    if (!t) return;
    if (!ask.cased && !caseIsOn(TOUR_CASE)) {
      keepTourAsk({ ...ask, cased: true });
      window.location.hash = `/${ask.route}`;
      void applyCase(TOUR_CASE).finally(() => window.location.reload());
      return;
    }
    setTour({ ...t, name: ask.app ? "How to get around the app" : (resolveRoute(`#/${ask.route}`).sub.label ?? ""), roams: t.steps.some((s) => s.route) });
  };
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    const asked = () => {
      const ask = takeTourAsk(route);
      if (ask) beginRef.current(ask);
    };
    setTour((t) => (t?.roams ? t : null));
    asked();
    window.addEventListener(TOUR_KEY, asked); // asked for on this page itself
    return () => window.removeEventListener(TOUR_KEY, asked);
  }, [route]);
  return (
    // each part's pages in its own colour (index.css: the accent follows data-part); the whole twin and Home/Help keep the palette's
    <div className="app" data-part={["dc", "heat", "district"].includes(tab.id) ? tab.id : undefined}>
      <TopBar
        active={tab}
        project={project}
        help={
          <HelpPop
            route={route}
            name={tab.subs.length > 1 ? `${tab.label} › ${sub.label}` : sub.label}
            onTour={TOURS[route] ? () => begin({ route }) : undefined}
            onAppTour={() => begin({ route, app: true })}
          />
        }
      />
      {tour && <Tour key={`${tour.name}@${tour.start}`} name={tour.name} steps={tour.steps} start={tour.start} onClose={() => setTour(null)} />}
      <div className="app__strip" />
      {/* the landing page has nothing to switch between: no sub-tab bar */}
      {tab.id !== "home" && (
        <div className="subtabs">
          {tab.subs.map((s) => (
            <button
              key={s.id}
              aria-current={s === sub ? "page" : undefined}
              className="subtabs__tab"
              onClick={() => (window.location.hash = hrefOf(tab.id, s.id))}
            >
              {SUB_ICONS[`${tab.id}/${s.id}`]}
              {s.label}
            </button>
          ))}
          {ownData && <DataCenterPicker project={project} route={route} onChange={() => repick((n) => n + 1)} />}
          {tab.id === "help" && (
            <a className="subtabs__tab" href="/docs/" target="_blank" rel="noreferrer" title="Opens in a new tab (available once the documentation is built)">
              Technical documentation <span aria-hidden>↗</span>
            </a>
          )}
        </div>
      )}
      {notice && (
        <div className="live-notice" role="status">
          <span>{notice.text}</span>
          {notice.reload && (
            <button type="button" className="btn btn--pill btn--primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <button type="button" className="btn btn--pill btn--ghost" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <main className="app__page">
        {/* keyed by route: a page that crashed is retried when you come back to it; by data center: opened afresh on
            another one; by revision: re-read after the assistant changed its data */}
        {mounted.map((r) => {
          const Page = PAGES[r];
          return (
            <div key={r} className="app__slot" hidden={r !== route}>
              <PageActive.Provider value={r === route}>
                <ErrorBoundary key={`${r}@${dataset}#${rev}.${picks}`}>
                  <Suspense fallback={r === route ? <p className="page muted">Loading…</p> : null}>
                    <Page />
                  </Suspense>
                </ErrorBoundary>
              </PageActive.Provider>
            </div>
          );
        })}
      </main>
    </div>
  );
}
