/**
 * The tutorial's three paths (Help › How to use, on top): what the Intelligent Digital Twin is for, one after the other:
 * ideation (the potential on the map), planning (the plant, on a model of each of the three parts) and operation (the
 * plant run through a year). Every step links to its page and starts that page's tour there (tours.ts), at the tour's
 * step titled `at` (else its first). Plain data: paths.test.ts checks it.
 */
export interface PathStep {
  text: string;
  route: string; // "tab/sub" (app/routes.ts), a page with a tour
  at?: string; // the title of the tour's step to start at
}

export interface TwinPath {
  id: "ideation" | "planning" | "operation";
  title: string;
  lead: string;
  needs: string;
  steps: PathStep[];
}

export const PATHS: TwinPath[] = [
  {
    id: "ideation",
    title: "1 · Concept",
    lead: "See the potential on the map: how much of a data center's heat the district around it could take, what the pipes cost and when they pay off.",
    needs: "Needs: an address. No data, no models.",
    steps: [
      { text: "On the Site map, find the data center and pick its building; set its installed capacity and utilization.", route: "twin/map" },
      {
        text: "② District: add the buildings that take the heat (click them, draw an area, or load the heat demand of the view).",
        route: "twin/map",
        at: "② The district",
      },
      {
        text: "③ Heat distribution: the network is planned along the streets; read the buildings supplied, the NPV and the break-even. “Costs and assumptions…” to change the prices.",
        route: "twin/map",
        at: "③ The heat network",
      },
      { text: "Turn the day and year dials: winter against summer.", route: "twin/map", at: "Day and year" },
      { text: "The Quick analysis: what the heat gives the district over a year, and the CO₂ it saves.", route: "twin/map", at: "The result" },
      { text: "Give the buildings their own demand profiles: District › Structure and Modelling.", route: "district/structure", at: "The modelling" },
    ],
  },
  {
    id: "planning",
    title: "2 · Planning",
    lead: "Plan the plant on a model of each of the three parts: the data center, the heat distribution and the district, matched hour by hour.",
    needs: "Needs: a model of each part: ready-made (a case, standard profiles, the library), or learned from data, or physics.",
    steps: [
      { text: "Pick a case, right of the page tabs: the three parts with their models, ready to run (Case 1).", route: "twin/matching", at: "Pick a case" },
      {
        text: "Planning: switch the heat exchanger, the heat pump and the storage on or off; read the coverage and the CO₂ saved.",
        route: "twin/matching",
        at: "The units",
      },
      {
        text: "A part without a model: its Calculation, a standard profile for the district, a heat pump or storage from the component library.",
        route: "twin/matching",
        at: "Model or Calculation",
      },
      { text: "Each part's data first: Visualization and Scenarios (KPIs, time series, correlations).", route: "dc/dashboard" },
      { text: "Its structure: the P&ID with its variables and the causal graph (which variable drives which).", route: "dc/pid", at: "First the P&ID" },
      {
        text: "Its models: data-driven (linear, XGBoost, TabPFN), physical equations or symbolic regression, scored on the test period.",
        route: "dc/pid",
        at: "The modelling",
      },
      { text: "What if? The Scenarios mode moves its levers and shows its KPIs.", route: "dc/dashboard", at: "Scenarios" },
      { text: "The same for the heat distribution and the district, then the three matched hour by hour.", route: "heat/structure" },
    ],
  },
  {
    id: "operation",
    title: "3 · Operation",
    lead: "Run the plant through a year: when the heat pump runs and the storage charges, for the least cost or CO₂.",
    needs: "Needs: the models of planning (or a case's). Operation runs on the plant Planning last ran.",
    steps: [
      { text: "Pick a case and open Planning once.", route: "twin/matching", at: "Pick a case" },
      {
        text: "Operation: three strategies on the same plant (heat-led, a price rule, MPC) and what each saves.",
        route: "twin/planning",
        at: "Three strategies",
      },
      {
        text: "Scenarios: other heat pump and storage sizes, wider price swings, more demand or more data center heat; add your own.",
        route: "twin/planning",
        at: "Scenarios",
      },
      { text: "Design options side by side, and their comparison.", route: "twin/planning", at: "Design options" },
      { text: "Your own plant: your models in Planning, then back here.", route: "twin/planning", at: "The plant" },
    ],
  },
];
