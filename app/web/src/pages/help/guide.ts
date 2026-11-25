/**
 * The "How to use" walkthrough as data: one entry per step, in the order a new user goes through the app.
 * Plain strings so GuidePage stays a small renderer and guide.test.ts can check every "Go there" route exists.
 * Keep the button names here in step with the pages when they change.
 */

export interface GuideStep {
  title: string;
  where: string; // where in the app, as the user sees it
  icon?: string; // section icon in public/
  go: { label: string; route: string }[]; // "Go there" links: "tab/sub" routes (app/routes.ts)
  see: string[];
  todo: string[];
  numbers?: string[];
}

const DC = "/icon-datacenter.png";

export const GUIDE: GuideStep[] = [
  {
    title: "Choose a data center",
    where: "Top bar, right, before the ⤓ ⤒ buttons: the project; on each page, right of the sub-tabs: Systems and Case",
    go: [],
    see: [
      "The app opens on Home (the house button at the top right, beside Connect AI): what the app is, the system figure (data center, heat distribution, district inside the whole twin) with each part's pages under its box and the whole twin's pages at its foot (hover a page for what it shows), and links to the DC2HEAT website, this walkthrough, the technical documentation and the API.",
      "Top bar, right, before ⤓ Save project and ⤒ Open project: the project, one version of your data folder (or the Examples). It holds many data centers; Change data folder… is in the same menu.",
      "On each page, at the right of the sub-tabs: Case picks the data center, the heat distribution and the district at once; Systems opens each one's menu, the Data center menu with the project's data centers in three groups (Simulations, Testbed, Real data centers), the one of this page by a short name (e.g. “Sim 1 · HEX”); hover over it, or open it, for the full name.",
    ],
    todo: [
      "Pick a project, then on a page its data center. Only that page re-opens on it; every page keeps its own, remembered in this browser, and a page not set yet opens on the last one you chose. Which causal graph a page draws is chosen on the page (Graph file).",
      "New to the app? Start with “Simulation 1 · with heat exchangers”: it has everything filled in.",
    ],
  },
  {
    title: "Visualization and Scenarios: look at the data first",
    where: "Data Center › Visualization and Scenarios, in Historical mode",
    icon: DC,
    go: [{ label: "Visualization and Scenarios", route: "dc/dashboard" }],
    see: [
      "The data of the chosen data center at a glance: how many rows and variables, the period, the time step, how complete the data is and where it has gaps.",
      "Data center KPIs where the columns allow them: PUE, ERF (energy reuse factor) and ERE (energy reuse effectiveness), all with IT + cooling as the total (plus the facility's other power, UPS, lighting and building, when it is chosen: then PUE is the full one), the IT energy, and the heat reused by the selected heat exchanger with the share of the heat demand it covers. A data center without a “kpi” mapping in its dataset.json shows a note instead.",
      "Every variable with its descriptive statistics (a heat exchanger's heat Q is marked “calculated”), its time series, the correlation matrix of all variables, and each variable's distribution (histogram) after them. The lines and chips are coloured by how Modelling makes each variable (blue data-driven, teal physical, orange profile, grey not modelled).",
      "Explore has more views than the time series: Daily profile, Weekly and monthly (the week by weekday and hour beside every variable's months), Autocorrelation and Missing data.",
    ],
    todo: [
      "Data with several files: pick the file in “Data file”.",
      "Click a column header of the variables table to sort by it (click again to reverse). In Time series, pick the period (Period and Month menus; the KPIs follow it) and the variables in the panel on the left, under the causal graph: click a chip to add or remove one, double-click it to show only that one (again: all), or All / None.",
      "In the correlation matrix, hover a cell for its value and click it to see the scatter of the two variables; “Similar together” puts strongly correlated variables next to each other.",
    ],
    numbers: [
      "Completeness: the share of cells (rows × variables) that have a value. A gap is a time step longer than 1.5 × the usual (median) step.",
      "r is the Pearson correlation: +1 the two variables rise together, −1 one falls when the other rises, 0 no linear relation. A crossed grey cell is a constant variable, which has no correlation.",
      "The charts show at most 1,500 points per variable: each point is the mean of a run of consecutive rows (a year of hourly data becomes 6-hour means, a month stays every row).",
    ],
  },
  {
    title: "Structure and Modelling: the structure",
    where: "Data Center › Structure and Modelling",
    icon: DC,
    go: [{ label: "Structure and Modelling", route: "dc/pid" }],
    see: [
      "The data center's P&ID (piping and instrumentation diagram): for the simulations a built-in drawing of an air-cooled data center (rack rows and the CRAH in the hall, water pipes only from the CRAH to the chiller and on to the cooling tower), or the real drawing. Every variable in the data is on it, linked or not. Every measured variable is an instrument bubble on it, tagged like on a P&ID (TT temperature, EQ energy, QT heat, …).",
      "Thin arcs are the causal links: which variable influences which. A variable and the links into it have the colour of how Modelling makes it (blue data-driven, teal physical, orange profile, grey not modelled); only an actuator or setpoint you can change in Scenarios sits in a square. On a built-in drawing a thin line leads from each variable to the equipment it measures.",
    ],
    todo: [
      "Pick the causal graph file in the menu at the top. For the simulations, choose where the heat is recovered (Condenser HEX or Hall HEX): the drawing, the causal graph and the Scenarios lists then show only that exchanger's three variables (inlet and outlet temperature, mass flow); its heat Q = ṁ·cₚ·(T_in − T_out) is calculated from them and shown as a small read-out next to the exchanger. The other's stay in the graph file. Where a data center has both a drawn and a paper P&ID, switch between them with Drawn P&ID / Paper P&ID.",
      "Move the slider from Topology to Graph in place to Causal graph: the drawing fades out, the links fade in, and the instruments move into a circle.",
      "Click an instrument to see what influences it and what it influences; click a link to edit its lag. The Variables bar above the drawing chooses which variables are drawn (search; “N of M shown” opens the list: tick, Show all / Hide all, chips that keep only the variables made one way, size; drag a name onto the drawing to place it there); its “+ Add link”: click the cause, then the effect; its “+ Variable” opens a name field under it (Enter or Add) and places another data column, or a new name, on the drawing. Drag instruments to where they sit in the plant; the mouse wheel zooms.",
      "The page opens to view; Edit (top right) brings the tools that change the structure, Done editing hides them. “Causal discovery” (TempCaFe, temporal causal feature selection) opens a menu: PCMCI or PC, the significance level, the lags, and whether to refine the drawn links or start blind from none; Run finds in the data how many time steps each link takes. A drawn link with no evidence is drawn dashed.",
      "“Import P&ID…” reads a PDF or SVG drawing, or a DEXPI file (the standard machine-readable P&ID format), and shows the components, connections and pipe runs it found; you can then use it as this data center's P&ID.",
      "“Save to <graph file>” writes your changes to the file picked at the top; “Save as…” writes a new file instead, to compare graphs later in Modelling.",
      "Unsaved changes are kept in this browser as a draft: after a reload or a crash the page shows “Restored unsaved draft”; Save keeps it, Discard goes back to the last save.",
      "“Select” (or Shift+drag, Shift-click) picks several variables: group them into one (their mean, e.g. one value per rack: only a mark, no values computed; the Dashboard lists the groups), mark their kind (sensor, setpoint, actuator, …) and how sure (a coloured ring), hide or delete them. The Changes box above the drawing lists what you and an assistant changed.",
      "“Views” (above the drawing) gives one part of the P&ID a drawing of its own: mark an area, name it, add its picture (Picture…), then click its name to zoom onto it. Its variables are linked with all others.",
    ],
    numbers: [
      "The number on a link is its lag: how many time steps (hours for hourly data) after the cause the effect shows; 0 = in the same step.",
      "↻n under an instrument: the variable also depends on its own past, up to n steps back.",
    ],
  },
  {
    title: "Structure and Modelling: the models",
    where: "Data Center › Structure and Modelling, scrolled down to Modelling",
    icon: DC,
    go: [{ label: "Structure and Modelling", route: "dc/pid" }],
    see: [
      "Under the structure, Modelling works on the graph drawn above (the same graph file, the links as drawn); the heat distribution's Structure and Modelling has the same, with its own equation library. On the left, the causal graph of the selected graph file (the selected heat exchanger's variables); click a variable for its results and its equation. Under it, once evaluated, the structural equation of the best model per variable in a small box that scrolls (the picked one marked), then the connection points and the KPI variables. On the right the results come first: a table that compares every model for every variable (a click on a row picks its variable), the rolling comparison and the setpoint events. “Model…” opens the modelling window above them: the variables in four columns (data-driven, physical and semi-physical, profile, not modelled), the training settings, the equations and the profiles; it opens by itself while nothing is trained or evaluated yet.",
      "Above the results table, the results of the variable you picked: every saved model of it with its free-run MAE, WAPE, R², MASE and nMAE, the best first and marked, each with Inspect (its fit up close). A variable without results says why (an input from the data, calculated, a profile, not modelled, no saved model, not evaluated yet).",
    ],
    todo: [
      "Connection points, in the left column under the causal graph: what this part must deliver to the rest of the twin, and how each of those variables is made here. The data center: its waste heat at each extraction point (both temperatures, and the heat or the mass flow; Q = ṁ·cₚ·ΔT gives the other); the heat distribution: the data center's waste heat in and the district heat out; the district: its demand and the network's supply and return. The weather (outdoor temperature, humidity, sun: what moves the three parts; wind is a second-order effect, left out) is shared by all three parts and always listed. Heat Matching runs on these points: a missing one is marked red, model it under Variables (a data center without heat exchanger columns: pick its columns under “Columns of the waste heat”). Click one to find it under Variables.",
      "KPI variables, under the Connection points (the data center only), folded with what PUE uses on its title (a click opens it): which variables are the IT power, the cooling power, the facility's other power (one or more: then PUE is the full one), the reused heat (one or more) and the heat demand, and the power unit; the formulas under them (PUE, ERF, ERE) show the bound names, or what is missing. Save KPI variables saves them for the Visualization's KPIs.",
      "“Model…” (on top of Modelling) opens the modelling window; in it, click the Data-driven column (not a variable in it) to open its training settings under the columns. Tick the model kinds (linear regression, XGBoost, physics with your equations, symbolic regression, TabPFN) and the structures: Causal graph = each variable is predicted from its parents in the graph, at the graph's lags; All vs all = from every variable at lags 1 to max lag, as a check of what the graph may miss.",
      "Pick the causal graph file, set the max lag for all vs all, and move the split slider: the models learn from the data up to “Train until …” and are tested on the rest (the test period).",
      "Variables: the graph's variables (on the data center's also every data column), each made one way, in four columns: Data-driven (learned on the causal graph), Physical and semi-physical (an equation, its coefficients learned or fixed), Profile, Not modelled. Drag a variable to another column or pick its approach with the arrow on it (dashed: no data); the data center's variables start data-driven, the heat distribution's physical, the district's as profiles (one without data is never data-driven). “Select all” / “None” models every data column, or none. Not modelled also holds the inputs (marked “from data”: taken from the data, not predicted (the graph decides: variables without causes in it, the actuators and weather; an input can get a profile instead), and the calculated columns. A “calculated” column (a heat exchanger's heat Q) is computed from other variables and never modelled. “+ Add variable” puts a data column that is not in the graph file into it, without links: it goes onto the drawing above, to place and link there.",
      "Physical and semi-physical: the equations of that column, trained as the Physics model kind. Write a variable's right-hand side, e.g. a * In_Temp[t-1] + b. Name[t-1] is the data one step back; any other name is a coefficient learned from the data. “+ Add equation” adds a row and moves its variable there, removing it moves the variable back; under each equation, “+ term” adds a coefficient times a variable and “+ constant to learn” a constant. The equation library has ready equations for heat exchangers, heat rejection, heat pumps and storage, rooms and pipes, pumps and fans.",
      "Click a variable, on the drawing above, on the causal graph, in the results table or in the columns, to see its results above the results table and its equation marked in the box on the left (the box scrolls to it, not the page). Open the Data-driven column: under “Train the models” every variable of it is listed with its best data-driven model and its scores; click a name to pick it, “Inspect” to see the fit.",
      "Press “Train N models”. The models are saved and tested; symbolic regression and TabPFN take a few minutes.",
      "Nothing is computed by itself: models saved earlier are tested when you press “Evaluate on the test period”. Each evaluation is kept beside the models; while they stay unchanged, the page opens with it (“The stored evaluation of the N saved models (unchanged since)”, with “Evaluate again”). Recovery · air cooled comes with one.",
    ],
    numbers: [
      "nMAE is the mean error as a share of the variable's typical size (mean absolute value): lower is better. Green up to 5 %, amber up to 15 %, red above.",
      "One step: predicting the next step from the real past. Free run: the model runs on its own predictions over the whole test period, fed only with the inputs taken from the data. This is the honest test for what-if questions.",
      "After setpoints: the error in a window after each setpoint change (choose the window length). Below the table you can look at one setpoint change and see each model against the measurement.",
      "Best: the winning model per variable (LR linear, XGB XGBoost, PHY physics, SR symbolic, TPF TabPFN).",
    ],
  },
  {
    title: "Scenarios: what if?",
    where: "Data Center › Visualization and Scenarios, in Scenarios mode",
    icon: DC,
    go: [{ label: "Visualization and Scenarios", route: "dc/dashboard" }],
    see: [
      "Switch the page from Historical to Scenarios (top right): the same page in amber. On top the KPIs with the levers; below the replay and the long period simulation. On the left, the causal graph of the trained model: click a variable to intervene on it; it lights up with everything it affects. Two modes: Step-through (replay) and Long period simulation.",
      "Both use the linear model trained on the causal graph under Modelling on Structure and Modelling, so train that first.",
    ],
    todo: [
      "Step-through: pick the variables to plot in the panel on the left (Visualization variables), play the measured data, change the speed or the window, or drag the time slider. Pause; the intervention variables are the ones picked in the panel on the left (or clicked on the causal graph, a second click releases one), the same as the KPI levers. Type constant values for them and the number of steps, then “Run What-If”. “Step Forward” reveals the prediction one step at a time, next to what really happened; “Exit What-If” ends it. “Re-prepare” re-trains the linear model with another train split.",
      "Long period simulation: choose the horizon and the variables to plot (the selected heat exchanger's Q is offered as “calculated”, from the predicted inlet, outlet and flow), “+ Add intervention” (set to, shift by, scale by ×, with a from / to date window; a variable clicked on the causal graph is added too), and press Run.",
    ],
    numbers: [
      "The simulation runs 50 times with random noise. The band is the 5 %–95 % range of those runs, the line in it the median. Blue = baseline (nothing changed), red = your scenario, grey = what was measured.",
      "“mean: actual · baseline · scenario · change” sums up the effect over the horizon.",
    ],
  },
  {
    title: "District: who takes the heat",
    where: "Intelligent Digital Twin › Site Map",
    icon: "/icon-quarters.png",
    go: [{ label: "Concept", route: "twin/map" }],
    see: [
      "Site map: the data center (red bubble) and the heat sinks (blue) on an OpenStreetMap map. A bigger bubble = more power, a deeper colour = hotter; a dashed outline is a whole district as one heat sink.",
    ],
    todo: [
      "Site map: search an address, “Pick another building” for the data center, “+ Buildings” to add buildings that take heat, or “+ Area (district)” to draw a district corner by corner. Edit the data center's name, temperature and power and a heat sink's name (its row shows its yearly demand, peak and supply, from its profile), then “Save site” (always at the bottom of the panel). Once Wärmeatlas buildings are loaded, “Heat sinks within” draws a circle around the data center (100 m steps, up to 1 km) and lists the heat sinks and the loaded buildings inside, nearest first (temperature and power; annual demand, “+” to add, “Add all within”); the buildings outside fade. A planning aid, not saved. “Profile of all” gives every heat sink the same profile (each one's own select overrides it); No profile by default; hover a sink or a Wärmeatlas building to see its profile, month by month, and click it to keep it shown, with a button to its profile in Modelling (“Profiles in Modelling →” opens them all). “Hide list” closes the sinks. The panel floats over the map: drag its top bar to move it, its edge to resize it; its cards (Data center, Heat sinks, Quick analysis) open and close with a click on their title, and the map's zoom and layers sit in it too.",
      "Site map, Frankfurt: “Load heat demand in view” draws the buildings of the view (at most 2 × 2 km; zoom in otherwise) coloured by their modelled heat demand from the Wärmeatlas Hessen (© LEA Hessen, imported once with scripts/import_waermeatlas.py, read locally). Hover a building for its use, age, floor area and heating + hot water; click it to add it as a heat sink with that demand, or “Add all in view”. “Non-residential correction” scales offices, shops and schools (LEA's model is about 45 % low for them).",
      "Site map: the “Quick analysis” card (in the panel, under the heat sinks) shows live, for one typical year, the heat recovered and the demand covered, the CO₂ saved, the electricity needed and the sinks' demand and peak, with the months as bars. Its data center: “On the map” (the card's waste heat kW at its supply °C) or “As in Heat Matching” (Heat Matching's own year once it has run in this browser, with its date; before that its model or data). A click on its title folds it; “Open in Heat Matching →” goes to the detailed view of the same site.",
      "Quick analysis, under the trees: “Show in the forest” draws the forest that takes up the CO₂ saved as soccer fields side by side (105 × 68 m each) in the Frankfurter Stadtwald, or the nearest forest, and flies there; pressed again, the map flies back. “Place the area” puts it where you click next.",
      "Heat distribution (the card under the Quick analysis): “Plan the heat network” lays pipes along the streets stored with the data center: a transmission line to a heat-pump station (HP), and from there under the streets into the buildings it can supply (most demand per metre of pipe, within reach of the station, while the heat pump the data center allows gives 75 % of the year's heat; the heat pump half the peak hour, a gas peak boiler for the rest). The card shows the buildings supplied, the km of pipe, the heat pump, the heat density, and the investment, the NPV over 20 years, the break-even year and the cost of heat. Hover a pipe for its size and load; drag the HP station and the plan follows (“Plan again” puts it back); “On the map” hides it. “Costs and assumptions…” opens every cost line, the BEW grant (at most the funding gap), the year, the cash flows and every assumption with its source, to change. Without stored streets, “Load streets from OpenStreetMap” asks for them (only on that click; not saved).",
    ],
  },
  {
    title: "Heat Distribution and District: Visualization and Scenarios",
    where: "Heat Distribution › Visualization and Scenarios, District › Visualization and Scenarios",
    icon: "/icon-heat-pipe.png",
    go: [
      { label: "Heat distribution", route: "heat/dashboard" },
      { label: "District", route: "district/dashboard" },
    ],
    see: [
      "The data center's Visualization and Scenarios, on one part only: its own variables (the heat distribution: each heat exchanger's heat, temperatures and flow; the district: its heat demand and the weather), their charts, correlations and statistics, and its causal graph on the left.",
      "Its KPIs at the top, in both modes: the heat distribution's heat recovered, electricity consumption, mean source and sink temperature and COP, each with how it is computed; the district's heat demand, peak and mean.",
    ],
    todo: [
      "Historical: the measured data. Scenarios: the part's own twin (trained under its Structure and Modelling) over the test period; move a lever and the KPIs at the top follow, with the measured value and the twin without a change beside them. The district's levers include the outdoor temperature: a colder winter.",
      "The whole twin, all parts together, is on Intelligent Digital Twin › Heat Matching.",
    ],
  },
  {
    title: "District: Structure and Modelling",
    where: "District › Structure and Modelling",
    icon: "/icon-quarters.png",
    go: [{ label: "Structure and Modelling", route: "district/structure" }],
    see: [
      "The district drawn like the data center's P&ID, with a very simple causal graph: the outdoor temperature sets the supply temperature (the heat distribution's heating curve); the weather, the hour of the day (daily habits), the number of units connected (n_units) and the supply temperature set the flow the buildings draw (m_dh, measured on the return; it keeps some of its own past: buildings store heat), and the return follows. The heat demand (Q_houses, on the red supply where it leaves the heat distribution) is calculated from the water, Q = m · cp · (T_supply − T_return): it causes nothing.",
      "Its starting variables are named as the data center's columns where it has them (the weather, e.g. Out_Temp, and the heat demand, e.g. Heat_Demand), so they have data from the start.",
    ],
    todo: [
      "The same tools as on the data center's Structure and Modelling: move, add and link variables (also the data center's weather columns, so Causal discovery and the models have data), import a drawing, Save.",
      "Under Modelling, only the heat demand starts as a profile (residential); every other variable starts Not modelled (move it to model it). Click a profile to open its generator: start from a building or area of the site map (each with its annual demand in MWh/a: add a Wärmeatlas building as a heat sink there first; all together, or each one), never applied by itself (or press a sink's ∿ on the Site map: its profile opens here, with “← Back to the site map”), or a standard profile (residential, BDEW gas profiles, a data center's waste heat, cooling, office hours, constant); a total over a day, week, month or year, one total or per unit × units, becomes a curve that holds exactly that total; “Shape it yourself” draws each part's average day, the weekdays and the months and sets how the outdoor temperature counts. Kept in this browser, not used by the models yet.",
      "Scroll on to Modelling: the same models and buttons, with the district's equation library (demand from the outdoor temperature, with wind, buildings that store heat, a daily profile).",
    ],
  },
  {
    title: "Heat Distribution: Structure and Modelling",
    where: "Heat Distribution › Structure and Modelling",
    icon: "/icon-heat-pipe.png",
    go: [{ label: "Structure and Modelling", route: "heat/structure" }],
    see: [
      "The heat distribution drawn like the data center's P&ID: the data center's water reaches the heat exchanger and the heat pump in parallel, their water fills the storage tank, which feeds the district. Its variables sit on it: the heat supplied by the data center and the district's demand, and the water on both sides of every part (supply and return temperature, mass flow), and the heat pump's load hp_load, an actuator (0 % off, 100 % full power). It starts with the causal links of the physics: slide right to see them.",
    ],
    todo: [
      "Drag the variables where they belong, “+ Variable” adds one (also one of the data center's data columns), a variable's Delete takes it off the drawing.",
      "Causal discovery learns the lags of the links between variables with data (the data center's columns added here) from the data center's data; links to variables without data are skipped.",
      "“+ Add link”, then click the cause and the variable it influences: the causal links of the heat distribution. The slider fades the drawing into the links.",
      "“Import P&ID…” puts a drawing of your own under the variables; views, the construct and the layers work as on the data center's P&ID.",
      "Save writes the graph file and the layout of the heat distribution: its own, apart from the data center's P&ID.",
      "Scroll on to Modelling: the same as the data center's, on this structure's graph, with the heat distribution's own equation library (heat pump COP, heat exchanger, tank, loops, demand). Save the structure first: training reads the saved graph. Nothing trains or evaluates by itself.",
      "Under its Connection points, “Plant models” picks a model per unit (heat exchanger, heat pump, thermal storage: a component of that kind, or the built-in formula): they are the heat distribution's Model on Heat Matching.",
    ],
  },
  {
    title: "Intelligent Digital Twin: does it match?",
    where: "Intelligent Digital Twin › Heat Matching",
    icon: "/icon-heat-pipe.png",
    go: [{ label: "Planning", route: "twin/matching" }],
    see: [
      "A flow diagram in three columns: Data center | Heat distribution (direct heat exchanger, thermal storage and heat pump) | District heat, with the mean flows of the selected week or day. Each connection is a pair of lines, supply (hot) and return (cool), labelled with their temperatures; ≈ marks an assumed return temperature. The key figures (with the CO₂ saved against gas heating) are above it. In the foot of each box, its card: whether the part runs its Model or its Calculation, and More options for the rest. Under the diagram: What if…, then the year (the outdoor temperature and the heat, daily means) and the chart of the selected week or day.",
    ],
    todo: [
      "Where the data center has several extraction points, click one in the data center box: an air-cooled one's hall heat exchanger (hot-aisle air) or condenser heat exchanger (cooling water), a water-cooled one's liquid cooling heat exchanger (rack water, about 50 °C) or condenser.",
      "Each of the three parts runs its “Model” or a “Calculation”. Model: what the part's Structure and Modelling delivers at its connection points, with a link there. Calculation: simple built-in formulas. A Model that cannot run yet is greyed out with the reason, e.g. no plant model picked.",
      "Data center: its Model is the trained model's free run where it gives the column, the rest as measured (More options lists each; the folder at the top right of its box, “Data center: model and system”, picks which trained model runs). Calculation: formulas from the IT and cooling power and the temperatures, their numbers under More options › Settings (“Compare with the Model” draws the Model's heat next to it). “Scale (× data centers)” multiplies the heat.",
      "Heat distribution: under More options, switch the Heat exchanger, the Heat pump and the Thermal storage on or off (saved for this data center). Both paths on: direct when the source is hot enough, heat pump otherwise. Its Model runs the plant models picked under its Structure and Modelling (a built-in formula for the others); Calculation the built-in formulas. Under Settings: “Use physical formulas” (an approach and a Carnot COP; off: a usable share and a fixed COP), the heat pump's capacity, the storage capacity and standing loss.",
      "District heat: its Model is the demand as District › Structure and Modelling makes it (its profile, or the measured column when it is not modelled); Calculation generates it from the Site map's heat sinks and the outdoor temperature. More options shows its energy, peak, supply and return.",
      "What if…: the Outdoor temperature shift makes the whole year warmer or colder, and under each box its lever (IT load, Heat pump, Heat demand). Weather from and Heat demand from take the weather or the demand from another dataset, e.g. District · heat demand: the data center's Model runs on them too. Every figure follows at once.",
      "Click or drag on the year to pick the week or day the diagram shows (or focus it and use the arrow keys); the chart below steps with its slider or ‹ ›.",
    ],
    numbers: [
      "Coverage: the share of the district demand met, and the hours fully met. Heat delivered against the demand (MWh). HP electricity: what the heat pump uses. SPF: heat-pump heat ÷ electricity.",
      "Unmet: demand that stays uncovered. Surplus: recoverable heat that nobody takes. CO₂ saved: the heat delivered had a gas boiler made it, minus the heat pump's grid electricity.",
    ],
  },
  {
    title: "Intelligent Digital Twin: planning and operation",
    where: "Intelligent Digital Twin › Operation",
    icon: "/icon-heat-pipe.png",
    go: [{ label: "Operation", route: "twin/planning" }],
    see: [
      "Design options of the heat distribution side by side over the same period (heat pump size, storage tank, heat exchanger on or off), each with its key figures, and how the chosen one runs.",
      "Heat pump operation: the same heat pump and tank run heat-led, by a price rule and by MPC (it plans the next hours, applies the first, plans again), with their cost, CO₂, starts and one week of each; change the plant, the COP model, the prices and what to optimise for.",
    ],
    todo: ["Edit, add or remove options and compare their figures; the heat matching's default settings are used."],
  },
  {
    title: "Save or open a project",
    where: "Top bar, right",
    go: [],
    see: ["Two buttons beside the project menu on the right of the top bar: ⤓ Save project and ⤒ Open project. On narrower screens only their icons show (hover for the name)."],
    todo: [
      "Save project writes one file into your data folder, status/<data center>/<data center>-project-<date>_<time>.json, a new one at every save, with everything you built for this data center: site, heat sinks and demand, P&ID layout, causal graphs, equations and trained models. A TabPFN model includes a sample of the training measurements, so treat project files of real data centers as confidential.",
      "Open project loads such a file into the same data center after you confirm. What was there before is kept in a backup.",
    ],
  },
];
