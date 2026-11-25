/** What the landing page says about each section and each of its pages, in plain words (home.test.ts checks every page has a line). */

/** One line per section tab, in the order the heat flows. */
export const SECTION_TEXT: Record<string, string> = {
  dc: "The source: its data, its structure, the models learned from it and what-if scenarios.",
  heat: "The link: how the waste heat gets from the data center to the district.",
  district: "The demand: who could take the heat, and how much they need.",
  twin: "The whole twin, made of the three parts: their heat matched hour by hour with what-if, and the heat distribution planned and operated.",
};

/** One line per page ("tab/sub" route). */
export const PAGE_TEXT: Record<string, string> = {
  "dc/dashboard": "Historical: the data at a glance; Scenarios: replay it and ask “what if?” with the twin. The data at a glance: how much there is, how complete it is, statistics, correlations and KPIs such as PUE.",
  "dc/pid": "The P&ID with its instruments and the causal graph, and under it the models learnt on it from the measurements and physics equations.",
  "heat/dashboard": "The heat distribution's own variables at a glance (each heat exchanger's heat, temperatures and flow) with its KPIs; Scenarios: move what its twin takes from the data and the KPIs follow.",
  "district/dashboard": "The district's heat demand and the weather that drives it, with its KPIs (demand, peak, mean); Scenarios: e.g. a colder winter, and the KPIs follow.",
  "heat/structure": "The heat distribution drawn like the P&ID, its causal links, and under it its models, as for the data center.",
  "twin/matching":
    "The three parts together: the data center's heat through heat exchanger, heat pump and tank against the district's demand, hour by hour, with what-if.",
  "twin/planning": "Design options of the heat distribution compared side by side, how the chosen one runs, and the heat pump's operation: heat-led, a price rule and MPC.",
  "twin/map": "The data center and the buildings and areas around it that could take its heat, on a map.",
  "district/structure": "The district drawn like the P&ID: the weather, the daily habits and the number of units driving the water the buildings draw, their heat demand calculated from it, and under it its models.",
};
