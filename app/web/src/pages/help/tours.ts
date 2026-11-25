/**
 * The tours ("?" › Explain this page, ui/Tour.tsx), shown on Case 1 (the example with everything in it: App puts it on
 * first): per "tab/sub" route, the steps of what to do there, each on the part of the page it is about, and where it can,
 * doing it (`act`: a click that shows the result, undone when the step is left). The three parts' pages share a tour
 * (one module each: DashboardPage, PidPage); a step one of them lacks is optional. APP_TOUR goes through the app page by
 * page. Keep the selectors in step with the pages: e2e/tour.spec.ts walks every tour.
 */
import { EXAMPLE_CASES } from "../../app/cases";
import type { TourStep } from "../../ui/Tour";

/** The case the tours show: Case 1, the example with trained models. */
export const TOUR_CASE = EXAMPLE_CASES.find((c) => c.name.startsWith("Case 1"))!;

const step = (kind: string) => `.site__step.site__tone--${kind} > button`; // the Site map's step that shows a card
const radio = (group: string, n: number) => `${group} [role="radio"]:nth-child(${n})`; // the n-th option of a Segmented
const PAGE_TAB = '.subtabs > button.subtabs__tab[aria-current="page"]'; // the open page's tab: where a tour says what it is for
const tab = (n: number) => `.subtabs > button.subtabs__tab:nth-of-type(${n})`;
const DAY_PLAY = ".maptime__dial--day .maptime__play";
const MODEL_WINDOW = ".train-bar > button";
const MODE = ".dash__mode div.segmented";
const VIEW = '.dash__explore div.segmented[data-label="View"]'; // data-label: as written (the aria-label is translated)
const STOP = ".pid-stage__stop";
const SOURCE = 'div.segmented[data-label="Data center source"]';
const AIM = 'div.segmented[data-label="Optimise for"]'; // in the plant's settings, beside the drawing
const WHAT_IF = "details.twin-whatif";
const SYSTEMS_MENU = ".subtabs__systems";

const MAP_INTRO: TourStep = {
  target: ".site__map",
  title: "Concept",
  text: "This page is for the potential, on the map: which buildings around a data center could take its heat, how long the pipes are, what they cost and when they pay off. E.g. Case 1: a data center in Frankfurt and 150 buildings around it.",
};
const MAP: TourStep[] = [
  MAP_INTRO,
  { target: ".site__search", title: "Find the place", text: "Search the data center's address, or move and zoom the map to it." },
  {
    target: ".site__steps",
    title: "Three steps, then the result",
    text: "① Data center → ② District → ③ Heat distribution, then the Quick analysis. A click on a step shows what to do there; a done step gets a tick.",
  },
  {
    target: ".site__group--source",
    click: step("source"),
    title: "① The data center",
    text: "Its building (“Pick another building”, then a click on the map), its installed capacity and utilization: the waste heat it gives in a year shows on top.",
  },
  {
    target: ".site__group--sink",
    click: step("sink"),
    title: "② The district",
    text: "The buildings that could take the heat, on the map in blue. Add more: click them (+ Buildings), draw an area, or load the heat demand of the view.",
  },
  {
    target: ".site__group--network",
    click: step("network"),
    title: "③ The heat network",
    text: "Planned along the streets from a heat pump station: see the pipes on the map, the buildings supplied, the pipe metres, the net present value over 20 years and the break-even.",
  },
  {
    target: ".maptime__box",
    act: `${DAY_PLAY}[aria-pressed="false"]`,
    undo: `${DAY_PLAY}[aria-pressed="true"]`,
    title: "Day and year",
    text: "The day plays now: hour by hour the water flows in the pipes and the figures change. Turn the dials yourself, or play the year: winter against summer.",
  },
  {
    target: ".site__group--quick",
    click: step("quick"),
    title: "The result",
    text: "What the data center's heat gives the district over a year: the share covered, the heat delivered, the CO₂ saved and the forest that would take as much.",
  },
  {
    target: ".site__save",
    title: "Save",
    text: "Save the site: it stays with this data center. Next: Planning, hour by hour with the three parts' models.",
  },
];

// Planning: what it is for, its KPIs on top, the middle (the heat's way, each part on its model), the
// what-if below
const MATCH_INTRO: TourStep = {
  target: PAGE_TAB,
  title: "Planning",
  text: "This page is for matching the three parts hour by hour, on their models. E.g. how much of the district's demand the data center covers in January, with or without a heat pump, in a colder winter.",
};
const MATCH_KPIS: TourStep = {
  target: ".heat-kpis",
  title: "On top: the KPIs",
  text: "Over the whole period: the coverage (the share of the district's demand met), the heat delivered, the CO₂ saved against gas heating, the heat pump's electricity and its seasonal performance (SPF).",
};
const MATCH_FLOW: TourStep = {
  target: ".heat-flow-card",
  title: "In the middle: the heat's way",
  text: "From the data center (left) through the heat distribution (heat exchanger, heat pump, storage) to the district (right), with the temperatures and the heat of the hour shown. “Model ›” on a box opens that part's modelling.",
};
const MATCH_WEATHER: TourStep = {
  target: ".hf-weather-row",
  title: "Above: the weather, for all three",
  text: "Outdoor temperature, humidity and sun act on all three parts at once: on the data center's cooling, on the heat pump and on the district's demand. A colder hour changes all three together, so they run on the same weather, hour by hour.",
};
const MATCH_LINKS: TourStep = {
  target: ".hf-links",
  parts: "rect", // the two: data center → heat distribution, heat distribution → district
  title: "Between them: the connections",
  text: "Where the parts meet: a supply and a return temperature and the heat at each connection point. What one part gives is what the next one gets: a warmer return or less IT load in one part moves the others. That is why the three are planned together, not one by one.",
};
const MATCH_MODEL: TourStep = {
  target: SOURCE,
  act: radio(SOURCE, 2),
  undo: radio(SOURCE, 1),
  title: "Model or Calculation",
  text: "Under each box: the part runs its Model (learned in its Structure and Modelling) or a simple Calculation. Switched to Calculation now: the KPIs follow; back to Model when you go on.",
};
const MATCH_WHATIF: TourStep = {
  target: WHAT_IF,
  act: `${WHAT_IF}:not([open]) > summary`,
  undo: `${WHAT_IF}[open] > summary`,
  title: "Below: what if?",
  text: "What if… (open now): another weather (warmer or colder by up to 10 °C, another year's), another demand, the network's temperatures; and each part's lever under its box. The KPIs above follow.",
};
const MATCHING: TourStep[] = [
  MATCH_INTRO,
  MATCH_KPIS,
  MATCH_FLOW,
  MATCH_WEATHER,
  MATCH_LINKS,
  MATCH_MODEL,
  {
    target: "div.heat-units",
    title: "The units",
    text: "The heat exchanger, the heat pump and the storage, each on or off: switch the heat pump off and see the coverage drop (it is saved with the heat distribution).",
  },
  MATCH_WHATIF,
  {
    target: ".subtabs__pickers",
    title: "Pick a case",
    text: "A case is a data center, a heat distribution and a district with their models, picked at once. Here: Case 1.",
  },
];

const OPERATION: TourStep[] = [
  {
    target: PAGE_TAB,
    title: "Operation",
    text: "This page is for running the plant through a year: when the heat pump runs and the storage charges. E.g. how much a price rule or MPC saves against following the demand, with a bigger storage, at wider price swings.",
  },
  {
    target: ".plan-plant",
    title: "The plant",
    text: "Operation runs on the plant Planning last ran: its heat pump, its storage and the data center's heat, drawn here.",
  },
  {
    target: ".plan-ops",
    act: radio(AIM, 2),
    undo: radio(AIM, 1),
    title: "Three strategies",
    text: "Heat-led follows the demand, the price rule charges in cheap hours, MPC plans ahead. Optimised for CO₂ now, back to cost when you go on.",
  },
  {
    target: ".plan-scenarios",
    title: "Scenarios",
    text: "Other sizes of the heat pump and the storage, wider price swings, more demand or more data center heat: each scenario runs all three strategies. Add your own.",
  },
  {
    target: ".plan-options",
    title: "Design options",
    text: "Variants of the heat distribution side by side: only a heat exchanger, heat pumps of different sizes, with storage.",
  },
  { target: ".plan-compare", title: "Compare", text: "The options' key figures side by side, in one table." },
];

// Visualization and Scenarios: what it is for, its KPIs, its visuals; its scenarios once the part has models
const VIS_INTRO: TourStep = {
  target: PAGE_TAB,
  title: "Visualization and Scenarios",
  text: "This page is for a part's data, and with its models its scenarios. E.g. how much heat the data center gave in 2023, its PUE in summer, what if its IT load rose by 20 %.",
};
const VIS_KPIS: TourStep = {
  target: ".dash__kpi-card",
  optional: true,
  title: "The KPIs",
  text: "The part's key figures over the period chosen; for the data center PUE, ERF, ERE, its IT energy and the heat reused.",
};
const VIS_VISUALS: TourStep = {
  target: ".dash__explore",
  act: radio(VIEW, 5),
  undo: radio(VIEW, 1),
  title: "The visuals",
  text: "Every variable as time series, daily and weekly profiles, correlations (shown now: which variables move together), distributions and gaps: look first, then model.",
};
const VIS_SCENARIOS: TourStep = {
  target: ".dash__kpi-card",
  optional: true,
  act: radio(MODE, 2),
  undo: radio(MODE, 1),
  title: "Scenarios",
  text: "With the part's models, Scenarios (on now) replays the period on its twin: move its levers and the KPIs follow. Back to Historical, the measurement, when you go on.",
};
const DASHBOARD: TourStep[] = [
  VIS_INTRO,
  VIS_KPIS,
  VIS_VISUALS,
  {
    target: ".causal-aside",
    optional: true,
    title: "The variables",
    text: "The causal graph beside the charts: click a chip to show or hide a variable; a double click shows only that one.",
  },
  VIS_SCENARIOS,
];

// Structure and Modelling: what it is for, the P&ID (yours uploaded), the variables placed on it, the causal graph as its
// abstraction, the models learned on that graph; then back to Visualization and Scenarios
const STRUCT_INTRO: TourStep = {
  target: PAGE_TAB,
  title: "Structure and Modelling",
  text: "This page is for the plant's structure and the models learned on it. E.g. where the heat exchanger's temperatures are measured, which variables drive the waste heat, a model that predicts it.",
};
const STRUCT_PID: TourStep = {
  target: ".pid-canvas",
  undo: `${STOP}:nth-of-type(1)`,
  title: "First the P&ID",
  text: "The plant's drawing: its pipes, units and instruments. Yours can be uploaded: Edit › “Import P&ID…” reads a PDF, SVG or DEXPI drawing.",
};
const STRUCT_VARS: TourStep = {
  target: ".pid-vars, .pid-controls",
  title: "Then the structure",
  text: "The variables of the data you load, placed on the P&ID where they are measured: in Edit, drag a variable from this list onto its instrument.",
};
const STRUCT_GRAPH: TourStep = {
  target: ".pid-controls",
  act: `${STOP}:nth-of-type(3)`,
  undo: `${STOP}:nth-of-type(1)`,
  title: "The causal graph",
  text: "The abstraction of that structure (shown now): only the variables, and which drives which, with its delay. Topology brings the drawing back.",
};
const STRUCT_MODELS: TourStep = {
  target: ".pid-below", // its Modelling, loaded once in view
  act: `${MODEL_WINDOW}[aria-expanded="false"]`,
  undo: `${MODEL_WINDOW}[aria-expanded="true"]`,
  title: "The modelling",
  text: "On that graph the relationships are modelled: each variable from the ones driving it, data-driven (linear, XGBoost, TabPFN), physical (equations) or by symbolic regression. The results say how well each predicts; “Model…” (open now) trains them.",
};
const STRUCTURE: TourStep[] = [
  STRUCT_INTRO,
  STRUCT_PID,
  STRUCT_VARS,
  STRUCT_GRAPH,
  STRUCT_MODELS,
  { target: tab(1), title: "Then: scenarios", text: "With the models there, back to Visualization and Scenarios: play the part's scenarios on its twin." },
];

export const TOURS: Record<string, TourStep[]> = {
  "twin/map": MAP,
  "twin/matching": MATCHING,
  "twin/planning": OPERATION,
  "dc/dashboard": DASHBOARD,
  "heat/dashboard": DASHBOARD,
  "district/dashboard": DASHBOARD,
  "dc/pid": STRUCTURE,
  "heat/structure": STRUCTURE,
  "district/structure": STRUCTURE,
};

/** How to get around the app (the "?" box's second button, the tutorial's), page by page on Case 1: on Home the system
 * (the analyses of all three together, each part modelled on its own or from an example, calibrated), ideation, then
 * planning (its KPIs, the middle, the what-if; Operation only marked), where each part's model comes from (the data
 * center's pages: its data, its P&ID and structure, the causal graph, the modelling, then its scenarios), the same for
 * the other two parts, and where to pick a case and get help. */
export const APP_ROUTE = "home/start";
const on = (route: string, s: TourStep): TourStep => ({ ...s, route });
export const APP_TOUR: TourStep[] = [
  {
    route: "home/start",
    target: ".home__frame",
    title: "The system",
    text: "A data center's waste heat goes through the heat distribution (heat exchanger, heat pump, storage) to the buildings of a district. The house at the top left brings you back here.",
  },
  {
    route: "home/start",
    target: ".home__twin",
    title: "All together: the analyses",
    text: "The three parts together are the Intelligent Digital Twin, with its analyses: ideation, planning and operation. This tour goes through them in that order.",
  },
  {
    route: "home/start",
    target: ".home__part-links",
    title: "Each part on its own",
    text: "Each part can be modelled on its own, from its data, on its pages. Or start from an example (Case 1, a standard model, a profile) and calibrate it with your measurements.",
  },
  on("twin/map", { ...MAP_INTRO, title: "1 · Concept: the Site map" }),
  on("twin/matching", { ...MATCH_INTRO, title: "2 · Planning" }),
  on("twin/matching", MATCH_KPIS),
  on("twin/matching", MATCH_FLOW),
  on("twin/matching", MATCH_WHATIF),
  {
    route: "twin/matching",
    target: tab(3),
    title: "3 · Operation",
    text: "Then Operation: the plant run through a year (heat-led, a price rule, MPC). It needs the models of planning: those first.",
  },
  {
    route: "twin/matching",
    target: SOURCE,
    title: "Each part runs on a model",
    text: "Here the data center's. For each system you can pick a standard model (a case's, a profile, or the simple Calculation) or create one from its data. Where? On its own pages, up here:",
  },
  {
    route: "twin/matching",
    target: '.topbar__parts [data-part="dc"]',
    title: "The data center's pages",
    text: "Data Center: its data, its structure and its models. Let us go there.",
  },
  on("dc/dashboard", VIS_INTRO),
  on("dc/dashboard", VIS_KPIS),
  on("dc/dashboard", VIS_VISUALS),
  {
    route: "dc/dashboard",
    target: `${SYSTEMS_MENU}[open] ${SYSTEMS_MENU}-pop`, // the menu, opened by its button
    click: `${SYSTEMS_MENU}:not([open]) > summary`,
    undo: `${SYSTEMS_MENU}[open] > summary`,
    title: "Your own data",
    text: "Systems (open now) › Data center › “Add a data center from a folder…” imports a data center of your own: its measurements (CSV), its P&ID and its causal graph.",
  },
  on("dc/pid", STRUCT_INTRO),
  on("dc/pid", STRUCT_PID),
  on("dc/pid", STRUCT_VARS),
  on("dc/pid", STRUCT_GRAPH),
  on("dc/pid", STRUCT_MODELS),
  on("dc/dashboard", { ...VIS_SCENARIOS, title: "Back: scenarios" }),
  {
    route: "dc/dashboard",
    target: ".topbar__parts",
    title: "The same for the other two",
    text: "Heat Distribution and District have the same pages: their data, their structure and models, then their scenarios. With all three: Planning, then Operation.",
  },
  {
    target: ".subtabs__pickers",
    title: "Case and systems",
    text: "Case picks a data center, a heat distribution and a district with their models at once (Case 1 now); Systems picks each one by itself.",
  },
  { target: ".topbar__help", title: "Help", text: "On every page: what it is for, its tour, this tour again and the tutorial with the three paths." },
];

/** A tour asked for by a link (the tutorial) or put off for Case 1 (App puts it on and loads the page again): kept for the
 * page it opens until that page starts it. */
export const TOUR_KEY = "tour";
export interface TourAsk {
  route: string;
  app?: boolean; // the app's tour (APP_TOUR), else the page's
  at?: string; // the title of the step to start at
  cased?: boolean; // Case 1 was put on for it: start it now, whatever is on
}
export function keepTourAsk(ask: TourAsk) {
  try {
    sessionStorage.setItem(TOUR_KEY, JSON.stringify(ask));
  } catch {
    /* the page opens without it */
  }
}
export function startTourAt(ask: TourAsk) {
  keepTourAsk(ask);
  window.location.hash = `/${ask.route}`;
  window.dispatchEvent(new Event(TOUR_KEY)); // the same page: no new route to look for it
}
/** The tour asked for on `route`, once (taken), or null. */
export function takeTourAsk(route: string): TourAsk | null {
  try {
    const ask = JSON.parse(sessionStorage.getItem(TOUR_KEY) ?? "null") as TourAsk | null;
    if (ask?.route !== route) return null;
    sessionStorage.removeItem(TOUR_KEY);
    return ask;
  } catch {
    return null;
  }
}
/** The steps an ask starts: the app's or the page's tour, from its step `at`. */
export function tourOf(ask: TourAsk): { steps: TourStep[]; start: number } | null {
  const steps = ask.app ? APP_TOUR : TOURS[ask.route];
  if (!steps) return null;
  return {
    steps,
    start: Math.max(
      0,
      steps.findIndex((s) => s.title === ask.at),
    ),
  };
}
