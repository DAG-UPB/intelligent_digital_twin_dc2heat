# Recovery · air cooled

A simulated air-cooled data center in Frankfurt whose hall heat goes to a low-temperature district loop, with the
district's heat demand beside it. `make.py` writes it to `app/data/sim_recovery_air/` (data, `dataset.json`,
`site.json`, `streets.json`, `causal_graph.json`, `equations.json`, six trained models with their stored evaluation in
`models/`, and the district's structure in `silver/district_structure`), where the app shows it as an example.

**Weather and clock.** Real hourly weather of 2023 and 2024 at the European Central Bank, Frankfurt am Main: ERA5
reanalysis from the Open-Meteo historical weather API (CC BY 4.0), in `weather_frankfurt.csv.gz` (UTC); the data
keeps the temperature and the humidity (the wind and the sun move nothing in the plant), on the hours of `data/sim_1`
(two years of 364 days; the separate district example `sim_district_heat` has the same hours). The time stamps are
UTC; the customers' day (`Hour`, `Is_Weekend`) follows Frankfurt's clock, summer time too.

**Size.** A 5 MW data center: IT 2,000 kW idle to 5,000 kW peak, a load of ~72 % of the design on average (3,616 kW
mean): the hall's level changes every one to four weeks, all levels in turn (0.12-0.82: customers moving in and out,
the HPC cluster's campaigns), a little higher in business hours, growing ~2.5 % a year. So the data hold IT loads from
~10 % to 100 %, and a trained twin answers a scenario anywhere there (XGBoost is flat outside the loads it was trained
on: with only 0.39-0.68 in the data, an IT load of 20 % and of 40 % gave the same heat). Server fans 0.6 % more per K of inlet air
above 24 °C. The supply-air setpoint `Cool_Set` (22-26 °C, ASHRAE recommended) is held for one to four weeks, then
changed. Its plant is that of the 750 kW case this example started as, scaled by `SCALE` = 5000/750.

**What it models: the whole facility.** IT, the cooling plant (CRAH fans, chilled-water pumps, the chiller and the
tower in summer, the electrical rooms' DX units), the UPS and distribution losses (`Elec_Loss_Ener`: a 2N
double-conversion UPS, ~93.5 % at its ~36 % load, and 3 % for transformers, PDUs, busbars) and the building
(`Building_Ener`: offices and control room, security, lighting, generator heaters). Of the IT power, cooling is 7.7 %,
the electrical losses 9.5 %, the building 3.5 %: a PUE (ISO/IEC 30134-2) of 1.21 (1.20 in winter, 1.23 in summer), as
the Dashboard shows it (`dataset.json` `kpi` `other_power`); IT and cooling alone, 1.08.

**Plant.** Hall air (CRAH, hot-aisle containment) gives its heat to the chilled water (18 °C supply, ~30 °C return).
On the chilled-water return sits the recovery heat exchanger, ahead of the free-cooling plate exchanger and the chiller.
It gives the hall's heat to the cold pipe of a low-temperature (5th generation) district loop, up to the loop's
capacity of 4,333 kW, as far as the pipe's temperature lets it. That pipe (`Loop_T_cold`, an input of the data center)
runs through the ground and warms when it gets more heat than the buildings' heat pumps take out: 6-8 °C in winter,
when the district takes everything (all the hall's heat recovered), ~20 °C in summer, when it needs ~0.65 MW of the
data center's ~3.7: then the recovery HEX takes ~68 % of the hall's heat and the free cooling (on the water it leaves)
and the chiller take the rest. The loop and the ground take the summer's surplus (no seasonal storage is modelled), so
`HEX_Hall_Q` is the heat the data center gives the loop (ERF 0.73 on the Dashboard); what the district uses of it, hour
by hour, is Heat Matching's.

**Energy balance, every hour, exactly:**

```
ITE_Ener + HVAC_Ener + Elec_Loss_Ener + Building_Ener = HEX_Hall_Q + Heat_rejected
HEX_Hall_Q = HEX_Hall_m · 4.18 · (HEX_Hall_T_in − HEX_Hall_T_out)     (dataset.json "derived")
```

| Year | IT | Cooling | Electrical losses | Building | Recovered (`HEX_Hall_Q`) | Rejected | Demand | PUE |
|---|---|---|---|---|---|---|---|---|
| 2023 | 31,165 MWh | 2,392 MWh | 2,984 MWh | 1,117 MWh | 27,483 MWh | 10,176 MWh | 29,861 MWh | 1.208 |
| 2024 | 32,019 MWh | 2,472 MWh | 3,033 MWh | 1,118 MWh | 28,472 MWh | 10,170 MWh | 30,223 MWh | 1.207 |

**Demand.** `Heat_Demand` is the district's heat: the demand of `../district_heat_demand/make.py` with UA 520 kW/K
on the 72 h mean outdoor temperature, a 2 K soft heating limit at 16 °C (German practice, VDI 4710 / VDI 3807), a day
curve of thousands of dwellings (peak/mean ~1.28 on a winter day) and 400 kW of hot water (~10 % of the heat): ~30,000
MWh a year, 203-14,713 kW, a town district of some 2,500-3,000 dwellings, on this data center's weather and with its
own noise (not the series of `sim_district_heat`). In January it asks ~1.5 times the heat pump's ~4.8 MW, in summer
~0.65 MW. Lifted by the heat pump (`hp_5mw` in `site.json` `heat_components`), the data center's heat covers ~80 % of
it hour by hour in Heat Matching, the rest in winter (*Case 1*, 2024, both on `xgb`: 79.1 %, 23.7 of 30.0 GWh
delivered, 6.14 GWh heat-pump electricity, 2,966 t CO₂ saved against gas). The heat distribution gets the loop's water
(`dataset.json` `heat_source` `hall`: `t` = `Loop_T_warm`, `t_return` = `Loop_T_cold`; ~19 °C on average, `site.json`
`source.temp_c`; 11 °C out and 6 °C back on a January week), so its heat pump lifts from there, as a building heat
pump on a 5th-generation loop does; the HEX's hot side (`t_in`, `t_out`, `m`) gives its Q. The other extraction point, the
condenser HEX on the chiller's condenser water (an alternative design on the same hours: the Structure page's and Heat
Matching's switch, and the what-if's), recovers more (~4.2 MW, the hall's heat plus the chiller's work, from ~33 °C
water) and gives the loop its own warm water, `Loop_T_warm_Cond` (~20 °C); its `HEX_Cond_*` and that pipe show when
it is picked (the buttons, or a click on its heat exchanger on the drawing), the hall's when the hall's is. To use another demand, pass it to `make(base, demand=...)`.

**District.** `make.py` also builds the district's structure (`silver/district_structure`): the prepared variables
`Out_Temp_mean24`, `Out_Temp_mean72` (24 h and 72 h rolling means, `scope` `district`: not on the data center's
structure) beside the data's `Is_Weekend`, the graph `Heat_Demand` ←
`Out_Temp`, its two means, `Is_Weekend` and `Hour` (lag 0: a demand follows the weather and the clock, not its own
past, so its twin runs free over a year without drifting), a semi-physical equation (`DISTRICT_EQUATIONS`: the soft
heating limit on the 72 h mean, the day curve as two harmonics of the hour, a weekend factor, hot water), and the
same six models as the data center (all vs all on the structure's own variables only). Heat Matching runs its `xgb`
(`site.json` `twin_model`). The Site map's heat sinks
are the residential buildings around the European Central Bank north of the Main, 150 of them within 420 m, from
OpenStreetMap (`district_buildings.json`, © OpenStreetMap contributors, ODbL), each with its share of the generated
demand of 2024 by floor area (heating limit 16 °C, 10 % hot water, 70/40 °C); a Wärmeatlas building (`wah-…`) is
never kept in the committed example; a sink you add on the map stays. The streets and paths among them, where the Site
map's heat network runs (`district_streets.json`, 750 OpenStreetMap ways over the sinks' box plus 150 m, ODbL), are
copied as `streets.json`; the Site map's *Heat distribution* card plans its pipes on them
(`docs/concepts/heat-network.md`). The data center's own Site-map temperature is the loop water's mean `Loop_T_warm`, 19 °C.

**Causal graph and lags.** The graph is the plant: each variable's links are exactly the causes `make()` computes it
from, each an hour before (lag 1), and `phys`'s equation for it uses exactly those links (`test_example_recovery_air.py`
checks both, and that the equations with the generator's numbers give the data). `Hour` and `Is_Weekend` are
Frankfurt's clock (summer time too), the customers' day: the IT load moves 30 %
of the way each hour toward the day's target (`IT_Load` ← `IT_Load`, `Hour`, `Is_Weekend`). The loop's water at the
recovery HEX: `Loop_T_warm` on to the heat distribution (`Loop_T_cold(t-1)` + `HEX_Hall_Q` / (173 kg/s · 4.18), the
loop pump's constant flow) and `Loop_T_cold` back from it, which follows the ground (the outdoor temperature over
weeks), the heat the HEX gives it and what the buildings' heat pumps take (`Loop_T_cold` ← `Loop_T_cold`, `Out_Temp`,
`IT_Load`, `In_Temp`, `Heat_Demand`). Those two, `IT_Load` and `Loop_T_cold`, have their causes in the graph but the
trained models take them from the data (`INPUTS`, as Modelling does with an actuator): the customers' noise and the
loop's slow states are no column's. The UPS losses follow the IT power
(`IT_Load`, `In_Temp`), the building the clock and the weather (`Hour`, `Out_Temp`). 22 variables, 55 links: kept to
what the heat and the energy need, both extraction points with their loop water (the free cooling works inside the
plant, its share is not a column; no hall humidity).

**Causal discovery, then training.** `make.py` runs the Structure page's *Refine the drawn graph* on the drawn links
(`DISCOVERY`: TempCaFe, tigramite PCMCI with partial correlation, lags 1-6, α 0.01, on 2023, about 6 s) and applies it
as the page does (`refine()`, as `applyDiscoveredLags` in `web/src/pages/datacenter/structure/links.ts`): each drawn
link gets the lags discovery finds significant, a link with none keeps its drawn lag (no evidence, kept), a variable's
own past is refined where the graph has it, no link is added or removed. The models are trained on that refined graph,
`causal_graph.json` (124 links, their strengths); the drawn one, every cause an hour before as `make()` computes it,
stays beside it as `causal_graph_drawn.json` (55 links) to compare with. Discovery confirms 40 of the 55 drawn links
and changes the lags of 27; it finds no significant lag for 15 (they keep lag 1): the 4 into the loop's cold pipe,
whose hour-to-hour change is mostly its own, `Is_Weekend` → `IT_Load`, 6 of `In_Temp`'s (the server fans' small
term, beside the IT load's large one) and 4 of the condenser design's, whose water the tower bypass holds nearly
constant. Some refined lags are statistical, not physical: a linear test sees an input's
effect through the plant's non-linear terms and its own autocorrelation (`IT_Load` → `HEX_Hall_T_out` at 3 h only,
where `make()` uses the hour before). On the refined graph `xgb` follows the recovered heat at R² 0.996.

**Models.** Every plant variable is data-driven by default (Modelling's start for a data center); `HEX_Hall_Q` is
calculated from its parts. Six models are trained on 2023: `linear`, `phys` and `xgb` on the causal graph (`MODELS`), and
the ones Modelling compares them with (`COMPARED`): `linear_all` and `xgb_all` (all vs all, lags 1-5) and `sym`
(symbolic regression on the graph). TabPFN is left out (minutes to train, and its model keeps training rows). Free run
over the held-out 2024 (R²):

| Variable | `xgb` | `phys` | `linear` | `linear_all` | `xgb_all` | `sym` |
|---|---|---|---|---|---|---|
| `ITE_Ener` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| `In_Temp` | 0.944 | 0.997 | 0.997 | 0.997 | 0.901 | 0.997 |
| `HEX_Hall_T_in` | 0.944 | 0.997 | 0.997 | 0.997 | 0.901 | 0.997 |
| `HEX_Hall_T_out` | 0.994 | 1.000 | 0.785 | 0.863 | 0.947 | 0.768 |
| `HEX_Hall_m` | 0.983 | 0.999 | 0.995 | 0.995 | 0.966 | 0.995 |
| `Loop_T_warm` | 0.997 | 1.000 | 0.994 | 0.996 | 0.732 | 0.994 |
| `HEX_Cond_m` | 1.000 | 1.000 | 0.991 | 0.991 | 1.000 | 0.993 |
| `HEX_Cond_T_out` | 0.997 | 1.000 | 0.800 | 0.801 | 0.389 | 0.837 |
| `Loop_T_warm_Cond` | 0.999 | 1.000 | 0.997 | 0.997 | 0.804 | 0.997 |
| `HVAC_Ener` | 0.977 | 1.000 | 0.841 | 0.852 | 0.883 | 0.836 |
| `Elec_Loss_Ener` | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.999 |
| `Building_Ener` | 0.965 | 1.000 | 0.558 | 0.732 | 0.996 | 0.555 |
| `Heat_rejected` | 0.983 | 1.000 | 0.800 | 0.845 | 0.860 | 0.788 |
| `HEX_Hall_Q` (calculated) | 0.996 | 1.000 | 0.892 | 0.928 | 0.968 | 0.881 |

`In_Temp` and what follows it carry the hall's noise (0.997 at best; `xgb`'s free run drifts a little more since the
IT load spans its whole range). The condenser design's `HEX_Cond_T_in` is held
at 32.5 °C nearly all year (the tower bypass at 27 °C plus the design range: a standard deviation of 0.03 K), so its
R² says little (`phys` 1.000, the linear ones ~0; left out of the table). The linear models cannot follow the free
cooling's and the loop's thresholds (`HEX_Hall_T_out`, `HVAC_Ener`).

`xgb_all`'s boosters are 7.9 MB of the example's 17 MB `models/` folder.

`phys` has an equation for every variable (`EQUATIONS`): the plant's data sheet as fixed numbers, the uncertain parts
as learned coefficients (with the generator's numbers it gives every column exactly). The district's `Heat_Demand`: `xgb` 0.995, `phys`
0.984, `linear` 0.887, `linear_all` 0.900, `xgb_all` 0.995, `sym` 0.886.

**Stored evaluation.** `make.py` evaluates the six models with `store` (`EVALUATE`: the lever `Cool_Set`, a window of
24 steps), so `models/evaluation.json` (~0.6 MB) holds the answer and Modelling shows the results as soon as it opens,
with nothing evaluated. The district's is in `silver/district_structure/models/` (git-ignored, made again by
`make.py`). Retraining a model makes the stored file stale (the app compares each model's content hash) until someone
evaluates again. Modelling's results table shows each variable's MAE, WAPE, R² and MASE, a click on a variable gives its
models' scores under the Variables card, and *Inspect* draws predicted vs measured. In Heat Matching pick the model in the data center's *model and system* select (*Case 1 ·
Recovery, trained models* runs `xgb` for both), and put another district's weather and demand in under *What if…* (see
`../district_heat_demand/README.md`).

**Regenerate** (from `app/`; about a minute with the models, 0.3 GB):

```bash
OMP_NUM_THREADS=1 bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py   # data + models
bash scripts/guard.sh .venv/bin/python examples/recovery_air_cooled/make.py --no-train          # data only
```

Then `POST /api/datasets/refresh` on the running app. The script's docstring derives the equations and gives the
literature range for every constant. The test is `tests/test_example_recovery_air.py`.
