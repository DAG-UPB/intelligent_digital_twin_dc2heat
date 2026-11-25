# Roadmap

Status: 2026-10-22 (branch `refactoring`). How things work: `../docs/`; how to change them: `../AGENTS.md`.

## Done

- **Shell:** three section tabs (District · Heat Distribution · Data Center) with hash routes and aliases for old links, a data center picker, save/open project (`dc-twin-project`), three palettes × light/dark, and help pages ("What is this?", "How to use") linking to the technical docs.
- **District › Site map:** Leaflet map (street, dark, satellite), address search and building look-up (OpenStreetMap), the data center's building, heat sinks as buildings, bubbles or drawn district areas.
- **District › Heat demand:** a profile generator per heat sink (houses × annual demand, heating limit with the 24 h mean outdoor temperature, daily curves you can drag, weekend shift, hot-water share, network temperatures) over the data center's evaluated period.
- **Heat Distribution:** extraction points from the data or physics, direct HEX / heat pump (Carnot-based COP) / auto, thermal storage, step-by-step matching with coverage, SPF, unmet and surplus, an animated flow diagram, and week/day windows.
- **Data Center › Physical structure:** causal graph on a P&ID (built-in drawing or an imported one), link and lag editing, lag discovery (PCMCI / PC, never saved automatically), and P&ID import from PDF/SVG with plant extraction, auto-assignment and suggested links.
- **Data Center › AI modelling:** five model kinds (linear, XGBoost, physics equations with a library, symbolic regression, TabPFN) × two structures (causal graph, all vs all), with one-step, free-run and after-setpoint scores and the best model per variable.
- **Data Center › Scenarios:** step-through replay with what-if, and a test-period Monte Carlo simulation with set/shift/scale interventions and baseline bands.
- **Engineering:** modular backend (`create_app`, routers, `core/`, `pid/`), structured frontend (`app/`, `api/`, `lib/`, `ui/`, `pages/`), pytest + vitest + Playwright on synthetic or read-only data, CI, all limits in `core/limits.py`, Sphinx docs.

## Proposed: architecture (2026-11-12, waiting for a decision)

An architecture decision proposes the following. Nothing is implemented yet. It also replaces the *District
heating data* item below: there will be no predictive district demand model.

- **This app is the app.** Older apps and prototypes get marked deprecated.
- **Computation moves to the backend:** Heat Matching (`matchHeat`), the profile generator and Operation's
  strategies and MPC move to `backend/core/`, each with a route.
- **Heat demand comes from two sources:** an uploaded measurement, or else the profile generator. The district model
  is dropped as a demand source, and the profile generator replaces `heat_demand()` in the example scripts.
  Chronos-2 is used only in Operation, to forecast the existing series.
- **No hand-over through `localStorage["heat-matching"]`:** Heat Matching saves its setup, and both pages post that
  setup to one endpoint.
- **One dispatch in the backend:** heat-led, price rule and MPC, for a day-ahead schedule with deviation costs and for
  hourly re-planning.

## Next

Only items the code or the earlier plan names as open:

- **District heating data:** import measured district-heating demand, and a **predictive demand model**, as an alternative to the generated profile (`web/src/lib/demand.ts`; the Heat demand page says "coming later").
- **More demand profiles:** besides houses, the profile kinds of the old forecast service (industrial, office building, hospital, swimming pool).
- **City heat-sink import:** read a file of a city's heat sinks and place them all on the map automatically.
- **Matching:** pipe losses and distance to the sinks, backup heat, CO₂ and cost as success measures.
- **Hourly aggregation:** an option to resample a dataset to hourly before training (lags then count hours), for the 5-second and 5-minute datasets.
- **Known shortcuts** marked `ponytail:` in the code, each with its upgrade path: evaluation scores every model on the first model's data file, the simulation clamp is ±1 training span, XGBoost hyperparameters are fixed, P&ID uploads are buffered before the size check, the PDF reader ignores form `/BBox` clips.
