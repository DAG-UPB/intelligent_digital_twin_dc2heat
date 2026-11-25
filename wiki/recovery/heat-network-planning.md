---
title: Heat-network planning on the Site map (route, sizes, costs, BEW, NPV)
tags: [district-heating, network, pipes, routing, heat-pump, costs, npv, lcoh, bew, funding, osm, streets]
summary: How the Site map's Heat distribution card lays a network along the streets (transmission line, heat-pump station, distribution, house connections), picks the buildings, sizes the pipes and the heat pump, and turns it into investment, BEW aid, NPV, break-even and cost of heat; with the defaults, their sources and the example's numbers.
---

# Heat-network planning (Site map › Heat distribution)

A fast first estimate of how the data center's heat reaches buildings and whether it pays, on the typical year.
Not a feasibility study: one heat price, a greedy route, a city's view (no taxes, no financing).

## Layout

`DC → transmission line (warm, the DC's water, along the streets) → heat-pump station (+ gas peak boiler) → distribution
pipes under the streets (70/40 °C) → house connections (straight from the street into the outline) → substations`.

## Streets

| Where | What |
|---|---|
| `streets.json` in the dataset (examples only) | `{about, source, bbox, ways}`; ways as `[lat, lon]` lines, rounded to 6 decimals (shared points join); ODbL attribution in `source`; `GET /api/datasets/{id}/site/streets`, 404 if none |
| `sim_recovery_air` | 750 ways over the sinks' box + 150 m, one Overpass query; copy of `app/examples/recovery_air_cooled/district_streets.json` |
| other sites | *Load streets from OpenStreetMap*: `streetsIn(box)` in `app/web/src/pages/district/osm.ts`, on click only; box ≤ 3 km; 45 s timeout; kept in the page, never saved |

Ways used: every road rank but motorways, service, pedestrian, footway, path, cycleway, track; no steps, corridors,
platforms; no road tunnels (`tunnel=yes`); bridges kept.

## Route and buildings (`planNetwork`, pure)

| Step | Rule |
|---|---|
| Graph | ways split at shared points; edge length haversine (`distanceM`); sidewalks and crossings left out; in the choice of a way (never in the metres) a footpath counts × 1.3, a dense street less (Wärmeatlas heat lines, *Prefer dense streets*); the connected part most of the demand is near |
| Join | DC, buildings, a dragged station: nearest point of the nearest segment (splits it); house connection straight to the nearest outline point; a building > 150 m from any street → unreached |
| Transmission | straight across the DC's grounds (≤ 150 m), then along the streets. No street within 150 m: one straight line of any length, planned and costed, with `HeatNetwork.warning` shown in red |
| Choose | grow from the station (Dijkstra); each step the building with most MWh/a per metre added, while it is within the reach (500 m along the streets) and the largest heat pump the DC allows still gives ≥ 75 % of the year's heat (demand + 25 W/m losses, hourly typical year) |
| Prune, regrow | bottom-up, cut a branch / house connection below `minDensity` MWh/(m·a) (default 1.5); then grow again without them (≤ 3 rounds) |
| Tree | the shorter of two Steiner trees, cleaned up; no building fed more than 1.5 × its shortest way + 50 m (in metres) |
| Station | if not dragged: 8 points along the street path DC → node nearest the demand-weighted centre; least pipe m per MWh; tie → nearer the load |
| Simultaneity | g(n) = a + (1 − a)/(1 + (n/b)^c), a 0.4497, b 53.84, c 1.762 (Winter, Haslauer, Obernberger 2001): ≈1 for 1, 0.527 for 150, → 0.45; a run's design peak = Σ design peaks below × g(n); a building's design peak: its largest hour on the typical year's coldest day (16 Jan) at −12 °C (`designKw`), ≥ its typical peak (~1.7× on the example) |
| Density | MWh/a ÷ (distribution + house-connection m); transmission not counted |
| Options | *Heat pump for the full peak*: only the buildings the heat pump covers at the peak; *All the data center's heat*: the heat pump as large as the DC allows, no reach |

Unreached reasons: "N m from the nearest street", "its street is not connected to the network's", "N m along the streets
from the station". No network when there are no streets.

## Sizes and the year (`hpSizing.ts`, `networkCost.ts`)

- **Supply**: hour by hour on Heat Matching's heating curve at its defaults (`lib/networkTemps.ts` `defaultCurve`; no
  setting on the site): the hottest sink's supply at −12 °C outside and below, 15 K less (≥ return + 10 K) at 15 °C and
  above; 70 → 55 °C. `quickAnalysis.ts` `yearSupply`.
- **COP** per hour = 0.5·(T_sup + 273.15)/max(T_sup − T_src, 5), clamped 1.1–8 (Heat Matching's Carnot default). The
  DC's heat is the heat used: no exchanger share off it. **Ceiling** = the largest hour of P_DC·COP/(COP − 1)
  (`capacityOnCurve`): the coldest hour's.
- **Heat pump** (`heatPumpKw`, shared with the Quick analysis): 50 % of the peak hour, raised until it gives 75 % of the
  year's heat, never above the ceiling. Source ≥ supply + 5 K: direct HEX, at most the station's size ("direct, no heat
  pump"; costed as an "Exchanger station": KWW Tab 40 a·P^0.38 at its size, no grid connection, no heat-pump O&M).
- **DN**: smallest that carries the run's largest hour of the typical year, at least its design peak (design day); table `PIPE_DNS`
  (DN20–300, KWW table 36 € per trench metre inner city / suburban; kW at 150 Pa/m and 30 K, scaled ×ΔT/30).
  Transmission: the most the heat pump draws from the DC in an hour (≤ all its heat) at the loop's ΔT (10 K). Above
  DN 300's capacity: n = ⌈kW / capacity⌉ DN 300s side by side, cost and loss × n, said in the costs dialog (`pipesOver`).
- **Losses**: table W/m × (T_mean − T_ground)/45; hot pipes (T_sup + T_ret)/2 at the design temperatures, transmission T_src − ΔT/2.
- **Year**: `matchHeat` hourly on the chosen sinks' profiles + losses, heat pump of the station's size, no tank, DC heat flat
  minus the transmission loss → HP heat and electricity, seasonal COP (shown as "seasonal COP"), gas boiler (largest unmet
  hour, at least the design hour less the heat pump, rounded up to 10 kW). The view's hours are Frankfurt's clock (`atHour`: spring's skipped 02:00 → 03:00, autumn's repeated 02:00 → the first).

## Money

| Part | Rule |
|---|---|
| Investment | HP €/kW; grid (BKZ) €/kW_el; pipes m × €/m by DN; substations a·P^0.379 each; pumps €/kW peak; boiler €/kW; planning % of pipes, pumps, substations; contingency % of all; study € |
| BEW conditions | > 16 buildings or > 100 dwellings, and ≥ 75 % of the heat (sold + losses) from the HP (its electricity included) |
| Modul 1 | ½ of the study |
| Modul 4 | (5.5 − (6.8 − 17/SCOP)·0.75) ct/kWh heat, ≤ 9.2 ct/kWh waste heat, 0 below SCOP 2.5; 10 years; ≤ 90 % of the HP's electricity cost. 35.5 €/MWh at SCOP 4.05 |
| Modul 2 | ≤ 40 % of eligible (not boiler, not study) |
| Cap | total aid ≤ funding gap = −NPV without BEW; Modul 2 first (≤ its 40 %, ≤ the gap); then the operating aid, scaled, for the rest. No gap → no aid but Modul 1 |
| Pump electricity | Σ_h flow (Q_h ÷ ρc_p·(T_sup,h − T_ret)) × head ÷ η; head = longest station→building path × 2 × 150 Pa/m + 1 bar fixed (estimate); η 0.7 (estimate); constant head all year; the DC's loop not counted. Case 1: 536 m, 2.6 bar, 100 MWh/a (0.5 % of the heat; was 2 %, 430 MWh) |
| Cash flows | prices +2 %/a, CO₂ +8 €/t·a, demand −1.3 %/a; renewals at the end of a life within the horizon; residual straight-line at year N (none for planning, contingency, study) |
| NPV | 20 years at 5 %, a nominal rate (the flows rise with the prices); horizon and lives in whole years |
| Break-even | first year the cumulative discounted cash flow ≥ 0; also simple payback = the year the undiscounted flows (no residual) have summed to the investment |
| LCOH | first-year heat price at which NPV = 0 (PV costs ÷ PV heat with the price rising): above it, it pays |

Defaults (39 numbers, 4 switches) with sources: `PARAMS` / `DEFAULT_PARAMS` in `networkCost.ts`; table with sources in
`docs/concepts/heat-network.md`. Main sources: KWW-Technikkatalog 1.1, Danish Energy Agency, BEW guideline, BAFA Modul 4,
BDEW, AGFW/ZfK, Jürgens et al. 2024. "estimate": contingency, study, CO₂ rise, price rise, loop ΔT, ground, metering, horizon.

## Example (`sim_recovery_air`, defaults, no heat lines; 2026-11-24)

| | |
|---|---|
| Supplied | 145 of 150 buildings (4 beyond the reach, 1 too thin), 21,502 MWh/a sold, 2,391 apartments, 51 % of the DC's heat used |
| Pipes | 4,516 m: 196 transmission (DN250), 2,825 distribution (DN200–32), 1,494 house connections (DN65–32) |
| Plant | HP 4,223 kW = half the peak hour (ceiling 4,399), seasonal COP 4.05, 19,064 MWh (85.6 %), 4,711 MWh electricity; boiler 4,320 kW, 3,206 MWh (14.4 %) |
| Density, losses | 5.0 MWh/(m·a), 3.4 % |
| Money | capex 17.55 M€, 17.50 after Modul 1; no funding gap; NPV +2.76 M€ (+0.72 without residual); break-even year 19, payback 12.0 a; LCOH 120 €/MWh vs 130 sold |

Sensitivity: BEW off 2.71 M€ / year 19; heat 110 €/MWh → gap 2.89 M€ closed by Modul 2 alone, NPV 0; heat 90 → the
full 40 % grant + Modul 4 at 12.5 €/MWh, NPV 0; heat 70 → −2.44 M€ with full aid; pipe × 0.6 → 5.90 M€ / year 14;
suburban 5.05 / 15; 3 % → 7.29 / 16. Quick analysis on the same site (all 150 sinks, a tank): HP 4,399 kW, 21,957 MWh
delivered, 72.6 %, 5,441 MWh electricity, 2,836 t CO₂.

## Traps

- Sidewalks and crossings are left out, but OSM's separate carriageways and paths beside roads still give parallel pipes: metres overstated.
- Pipes, pumps, boiler: design day (−12 °C) × simultaneity, at least the typical year's largest hour. The profiles share one weather, so on the example the summed typical hour still decides for trunk, pumps and boiler (design × 0.53 is 9 % short); the design peak decides for house connections and short runs.
- The heating curve has no setting on the Site map (Heat Matching's defaults). The grid connection is sized for the year's largest hour of heat-pump electricity.
- Funding gap ≠ BAFA's calculation (comparison case, lives); the BEW guideline runs until 2028.
- Not modelled: connection rate < 100 %, connection fees, storage.
- KfW 271's old minimum was 500 kWh per metre of trench a year (0.5 MWh/(m·a)); the default 1.5 is a planning rule of thumb.

## In this app

- Card and map layer: `app/web/src/pages/district/HeatNetwork.tsx` (in `SitePage.tsx`, group `network`, under the Quick analysis); dialog `NetworkCosts.tsx`.
- Routing: `app/web/src/pages/district/network.ts`; the heat pump's size: `hpSizing.ts`; money: `app/web/src/pages/district/networkCost.ts`; streets: `osm.ts` `streetsIn`, `app/web/src/api/site.ts` `fetchStreets`, `app/backend/routers/site.py` `get_streets`, schema `Streets` (`app/backend/schemas.py`).
- Browser keys: `site-network` (assumptions), `site-network-station:<dataset>` (dragged station). Nothing in `site.json`.
- Assistant: page snapshot `heat_network` (lengths, buildings, sizes, every cost line, NPV, break-even, funding gap, parameters); no page command: click the buttons with `ui_do`.
- Tests: `app/web/src/pages/district/network.test.ts`, `hpSizing.test.ts`, `networkCost.test.ts`, `networkView.test.ts`, `app/web/e2e/network.spec.ts`.

## See also

- [Heat matching](heat-matching.md) (the `matchHeat` year, CO₂ factors)
- [Heat pumps and storage](heat-pumps-and-storage.md)
- [District heating and heat pumps](../temperatures/district-heating-and-heat-pumps.md)
- [The example datasets](../datasets/examples.md)
- Human docs: `docs/concepts/heat-network.md`, `docs/user-guide.md` (Site map)

## Sources

- KWW-Technikkatalog Wärmeplanung 1.1 and Begleitdokument (dena / KWW, 2026).
- Danish Energy Agency: Technology Data for Energy Transport; Technology Data, waste-heat heat pumps (2025).
- Bundesförderung für effiziente Wärmenetze (BEW), BAnz AT 18.08.2022 B1; BAFA, Merkblatt BEW Modul 4 (2023).
- Jürgens et al. 2024, data-centre waste heat in Frankfurt, Int. J. Sustainable Energy Planning and Management 41.
- Winter, Haslauer, Obernberger 2001, Gleichzeitigkeit in Nahwärmenetzen, Euroheat & Power 30.
- Nussbaumer, Thalmann 2017 (pressure drop 150–200 Pa/m); KfW Programm 271/281 Merkblatt (500 kWh/(m·a)).
- © OpenStreetMap contributors, ODbL 1.0 (streets).
