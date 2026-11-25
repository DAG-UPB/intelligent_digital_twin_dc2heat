---
title: App map for agents (pages, work order, MCP tools)
tags: [app, pages, routes, workflow, mcp, ui_snapshot, ui_do, ui_state, read_docs, wiki_search, agents]
summary: Every page of the app with its hash route and purpose, the order to work in, and which MCP tools to use for what, with the safety rules.
---

# App map for agents

## Pages (`app/web/src/app/routes.ts`; one line each in `app/web/src/pages/help/home.ts`)

Tabs run left to right the way the heat flows: data center → heat distribution → district → the whole twin.

| Route | Page | What it is for |
|---|---|---|
| `home/start` | Home | landing page, one line per page |
| `dc/dashboard` | Data Center › Visualization and Scenarios | data at a glance (statistics, gaps, correlations, PUE/ERF/ERE), *Prepare variables*, *Aggregate data*; Scenarios: replay with levers |
| `dc/pid` | Data Center › Structure and Modelling | the P&ID with instruments + causal graph; below it Modelling: connection points, approaches, profiles, Train, Evaluate |
| `heat/dashboard` | Heat Distribution › Visualization and Scenarios | each HEX's heat, temperatures and flow, its KPIs, what-if |
| `heat/structure` | Heat Distribution › Structure and Modelling | the heat distribution drawn like a P&ID, its links and models |
| `district/dashboard` | District › Visualization and Scenarios | heat demand and weather, KPIs (demand, peak, mean), e.g. a colder winter |
| `district/structure` | District › Structure and Modelling | weather, habits, units → demand; choose a measured demand here |
| `twin/map` | Intelligent Digital Twin › Site Map | the DC and the buildings/areas that could take its heat; heat sinks; Wärmeatlas layer; *Quick analysis* (with its forest as soccer fields); *Heat distribution* (the network along the streets, its costs, NPV, break-even) |
| `twin/matching` | › Heat Matching | DC heat through HEX, heat pump, tank vs demand, hour by hour, with *What if…* |
| `twin/planning` | › Operation | design options of the heat distribution side by side, how the chosen one runs, and the heat pump's operation: heat-led, price rule and MPC on the same plant (cost, CO₂, starts; COP from Carnot or a plant model) |
| `help/about`, `help/guide`, `help/assistant` | Help | what it is, the walkthrough (`guide.ts`), the AI assistant |

Old routes resolve through the `OLD` alias table (e.g. `#/heat/flow` → matching). Never rename a route.
The dataset is chosen per page (select right of the sub-tabs, `localStorage["dataset:<tab>/<sub>"]`).

## Work order

1. **Pick a dataset**. Use the examples to learn ([datasets](../datasets/examples.md)).
2. **`dc/dashboard`**: look at the data first: gaps, units (kelvin?), meters as counters, KPIs (choose the KPI variables).
3. **`dc/pid`, structure**: place variables on the P&ID, draw links, then *Edit* › *Causal discovery* for the lags (a suggestion; only the user's Save writes).
4. **`dc/pid`, Modelling**:
   - check the connection points ([interfaces](../interfaces/three-parts.md));
   - choose the approach per variable ([approaches](../modelling/approaches.md));
   - Train, then Evaluate on the free run ([pitfalls](../modelling/evaluation-and-pitfalls.md)).
5. **`dc/dashboard` Scenarios**: interventions on levers ([simulate](../modelling/simulate-and-drivers.md)).
6. **`twin/map`, `district/*`**: heat sinks, demand settings, profile ([profiles](../profiles/profile-generator.md)).
7. **`heat/structure`**: the units and their components ([heat pumps](../recovery/heat-pumps-and-storage.md)).
8. **`twin/matching`**, then **`twin/planning`** ([matching](../recovery/heat-matching.md)).

## MCP tools (server `digital-twin`, `app/backend/mcp_server.py`; overview `docs/architecture/mcp.md`)

The tool set is being extended in parallel. Read the server's own tool list for the exact names and arguments.

| Group | Tools (typical) | Use |
|---|---|---|
| Knowledge | `wiki_search`, `wiki_read` (this wiki), `read_docs` (`docs/`, e.g. `concepts/models`) | search here first, then the docs |
| API, read | one tool per GET route and compute-only POST: `list_datasets`, `get_summary`, `get_data`, `get_graph`, `get_equations`, `check_equation`, `discover_link_lags`, `evaluate`, `simulate`, `get_site`, `list_components`, `simulate_component`, `fit_component`, … | facts and computations, no files changed |
| API, write | tools marked **`[writes]`**: `save_graph`, `save_equations`, `train`, … | only on `sim_*` or when the user asked for that change |
| Pairing | `connect_app` with the six-digit code from *Connect AI* | required before any page tool |
| The open page | `ui_state` (route, dataset, what is shown), `ui_snapshot` (controls by name/ref, drawing texts and shapes), `ui_do` | work **through the page**, as the user would |
| P&ID | `pid_view` (image + 0..1 grid, zoom `region`, `scope` dc/heat/district), `pid_place` `[writes]` | reading a drawing, placing variables |

`ui_do` actions (`COMMANDS` in `app/backend/core/live.py`):

- generic: `click {control}`, `fill {control, value}`, `navigate {route}`, `open_dataset {dataset}`, `message {text}`, `scroll {to}`;
- Heat Matching: `set_window` (number or date of the year picker's band), `set_part_way {part: dc|heat|district, way: model|calculation}`;
- Modelling's profile generator: `set_profile_shape` (`day` 24, `weekday` 7, `month` 12 values);
- Physical structure: `place_instruments`, `set_links`, `select_variables`, `group_variables`, `annotate_variables`,
  `add_view`/`open_view`, `save_draft`/`discard_draft`, digital-construct shapes;
- Site map: `map_focus`, `map_click`, `pick_atlas_building`.

Loop: **look (`ui_snapshot`) → act (`ui_do`) → look again.** Do it rough first: place everything in one call,
show the user, then refine. Unsaved structure work stays a browser draft until the user presses Save.

## Safety rules (from AGENTS.md)

- Never open real data, only `app/data/sim_*`. Never name or describe real sites.
- Tool results go to the LLM provider, including P&ID images, time series and project exports of real data centers.
- No `[writes]` tool and no Save/Train/*Use as P&ID*/*Open project* on real data unless the user asked for it.
- Lag discovery is a suggestion. Never save discovered lags on your own.
- Run Python under `app/scripts/guard.sh` (2 GB budget).

## See also

- [Index](../index.md) · [Glossary](../glossary.md)
- [Recovery + district click path](../datasets/recovery-and-district.md)
- Human docs: `docs/user-guide.md`, `docs/architecture/mcp.md`, `docs/development/working-with-agents.md`

## Sources

- `AGENTS.md`, `app/web/src/app/routes.ts`, `app/web/src/pages/help/home.ts`, `app/backend/core/live.py`, `docs/architecture/mcp.md`.
