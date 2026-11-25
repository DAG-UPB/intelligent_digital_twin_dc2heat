/**
 * Navigation: hash routes `#/<tab>/<sub>` (no router library). TABS are the three big section tabs, left to
 * right as the heat flows: data center (source) -> heat distribution -> district (demand). HOME, the landing page, is
 * the default and is reached from the house button; HELP from the "?" button. OLD keeps links from before the
 * regrouping (bookmarks) working.
 */

export interface SubRoute {
  id: string;
  label: string;
}

export interface TabRoute {
  id: string;
  label: string;
  icon: string; // mask image in public/, takes the text color ("": none)
  subs: SubRoute[];
  whole?: boolean; // the whole twin, made of the part tabs before it: the top bar's brand name is its button
}

export const TABS: TabRoute[] = [
  {
    id: "dc",
    label: "Data Center",
    icon: "/icon-datacenter.png",
    subs: [
      { id: "dashboard", label: "Visualization and Scenarios" },
      { id: "pid", label: "Structure and Modelling" },
    ],
  },
  {
    id: "heat",
    label: "Heat Distribution",
    icon: "/icon-heat-pipe.png",
    // its structure and its models; the flow: data center (two extraction points) -> recovery / heat pump -> storage -> district
    subs: [
      { id: "dashboard", label: "Visualization and Scenarios" }, // its own variables and KPIs, as the data center's
      { id: "structure", label: "Structure and Modelling" },
    ],
  },
  {
    id: "district",
    label: "District",
    icon: "/icon-quarters.png",
    subs: [
      { id: "dashboard", label: "Visualization and Scenarios" },
      { id: "structure", label: "Structure and Modelling" },
    ],
  },
  {
    id: "twin",
    label: "Intelligent Digital Twin",
    icon: "",
    whole: true,
    // the three parts together: their heat matched hour by hour with what-if, and the plant planned and operated
    subs: [
      { id: "map", label: "Concept" }, // where everything is: the data center and the district around it
      { id: "matching", label: "Planning" },
      { id: "planning", label: "Operation" },
    ],
  },
];

/** The landing page: not a section tab; opened from the house button in the top bar, and the default route. */
export const HOME: TabRoute = { id: "home", label: "Home", icon: "", subs: [{ id: "start", label: "Home" }] };

/** Help: not a section tab; opened from the top bar. */
export const HELP: TabRoute = {
  id: "help",
  label: "Help",
  icon: "",
  subs: [
    { id: "about", label: "What is this?" },
    { id: "guide", label: "How to use" },
    { id: "assistant", label: "AI assistant" },
  ],
};

const ROUTES = [...TABS, HOME, HELP];

/** Links from before the regrouping (bookmarks): old tab/sub -> new tab/sub. */
export const OLD: Record<string, string> = {
  "site/map": "twin/map",
  "quarters/map": "twin/map",
  // the site map is the whole twin's overview now
  "district/map": "twin/map",
  "graph/pid": "dc/pid",
  "graph/circular": "dc/pid",
  "train/linear": "dc/pid",
  // AI modelling and Components became the Modelling under each structure
  "dc/train": "dc/pid",
  "heat/components": "heat/structure",
  // the heat matching moved to the whole twin
  "heat/flow": "twin/matching",
  // Scenarios became the Dashboard's Scenarios mode (these addresses open it in that mode)
  "dc/scenarios": "dc/dashboard",
  "scenarios/step": "dc/dashboard",
  "scenarios/year": "dc/dashboard",
  "dc/step": "dc/dashboard",
  "dc/year": "dc/dashboard",
  "blocks/physical": "twin/matching",
  "blocks/data": "twin/matching",
  "heat/physical": "twin/matching",
  "heat/data": "twin/matching",
  "heat/blocks": "twin/matching",
  "heat/matching": "twin/matching",
  "matching/diagram": "twin/matching",
  // Heat demand's profile generator went into each structure's Modelling (the district's heat demand is a profile)
  "district/demand": "district/structure",
};

/**
 * The page a location hash shows. In order: an exact OLD alias; a live tab id (an unknown or missing sub
 * opens its first sub, so "#/dc" is dc/dashboard); an old tab without its sub ("#/train") via the first OLD key
 * under it; anything else (an empty or unknown hash) is the landing page.
 */
export function resolveRoute(hash: string): { tab: TabRoute; sub: SubRoute } {
  let path = hash.replace(/^#\/?/, "");
  const live = ROUTES.some((t) => t.id === path.split("/")[0]);
  const old = OLD[path] ?? (live ? undefined : Object.entries(OLD).find(([k]) => k.startsWith(`${path}/`))?.[1]);
  if (old) path = old;
  const [tabId, subId] = path.split("/");
  const tab = ROUTES.find((t) => t.id === tabId) ?? HOME;
  return { tab, sub: tab.subs.find((s) => s.id === subId) ?? tab.subs[0] };
}

/** The hash of a page, e.g. "#/dc/pid". */
export const hrefOf = (tab: string, sub: string) => `#/${tab}/${sub}`;
