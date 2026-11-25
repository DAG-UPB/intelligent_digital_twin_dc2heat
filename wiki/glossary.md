---
title: Glossary (English / German)
tags: [glossary, terms, german, english, abwaerme, waermenetz, vorlauf, ruecklauf, waermepumpe, waermeatlas]
summary: Data center, cooling, district heating and modelling terms in English and German with one-line meanings and the app's names for them.
---

# Glossary

| English | German | Meaning (app name) |
|---|---|---|
| waste heat | **Abwärme** | heat a process gives off; here the data center's (`Q_dc`, `HEX_*_Q`) |
| heat recovery / extraction | Wärmerückgewinnung, Wärmeauskopplung | taking waste heat out at an extraction point (`heat_source`) |
| heat network, district heating | **Wärmenetz**, Fernwärme (large), Nahwärme (local) | pipes that carry hot water to buildings (the district) |
| cold district heating, 5GDHC | kalte Nahwärme, Anergienetz | 5–30 °C loop with heat pumps in each building |
| supply (flow) | **Vorlauf** | the line leaving the heat source, hot in a heating network (`T_dh_supply`, `t_in`) |
| return | **Rücklauf** | the line coming back, cooler (`T_dh_return`, `t_out`) |
| temperature spread | Spreizung | supply − return ΔT |
| approach | Grädigkeit | smallest temperature difference in a HEX |
| heat pump | **Wärmepumpe** | lifts heat to a higher temperature with electricity (`P_el_hp`) |
| coefficient of performance (COP) | Leistungszahl | heat (or cold) per electricity at one point |
| seasonal performance factor (SPF) | Jahresarbeitszahl (JAZ) | the same over a year (`spf`) |
| chiller | Kältemaschine, Kälteanlage | heat pump run for its cold side |
| dry cooler | Rückkühler (trocken) | air-cooled heat rejection, no water |
| cooling tower | Kühlturm (Nasskühlturm) | evaporative heat rejection |
| adiabatic cooling | adiabate Kühlung | evaporative pre-cooling of the air |
| free cooling | freie Kühlung | cooling without the compressor (`FC_Share`) |
| CRAC / CRAH | Umluftkühlgerät (DX / Kaltwasser) | room air unit, refrigerant / chilled water |
| raised floor | Doppelboden | supply air plenum under the floor |
| cold / hot aisle | Kaltgang / Warmgang | the racks' inlet / exhaust side |
| chilled water | Kaltwasser | 6–20 °C water loop to the air units |
| heat exchanger (HEX) | Wärmeübertrager, Wärmetauscher | passes heat between two fluids |
| thermal storage, buffer tank | Wärmespeicher, Pufferspeicher | stores hot water (`tankKwh`) |
| domestic hot water (DHW) | Trinkwarmwasser (TWW) | year-round base of the demand |
| space heating | Raumwärme | weather-driven part of the demand |
| heat demand / consumption | Wärmebedarf / Wärmeverbrauch | computed need / measured use (`Heat_Demand`, `kpi.heat_demand`) |
| design heat load | Heizlast (DIN EN 12831) | peak W at the design outdoor temperature |
| heating limit temperature | Heizgrenztemperatur | daily mean above which there is no heating (`heatingLimit`) |
| degree days | Gradtagzahl, Heizgradtage | Σ (base − daily mean) ([profiles](profiles/heat-demand-profiles.md)) |
| standard load profile | Standardlastprofil (SLP) | BDEW typical profile for unmetered customers |
| full-load hours | Volllaststunden | annual energy / peak power |
| coverage | Deckungsgrad | share of the demand covered (`coveragePct`) |
| heat atlas | **Wärmeatlas** | map of building heat demand; the app imports the LEA Hessen one (`app/backend/core/waermeatlas.py`) |
| municipal heat planning | kommunale Wärmeplanung (WPG) | the legal plan for a town's heat supply |
| Energy Efficiency Act | Energieeffizienzgesetz (EnEfG) | German law with PUE/ERF limits for data centers ([metrics](datacenter/metrics.md)) |
| data center | Rechenzentrum (RZ) | |
| UPS | USV (unterbrechungsfreie Stromversorgung) | battery backup |
| genset | Netzersatzanlage (NEA) | diesel backup |
| connected load | Anschlussleistung | contracted electrical/thermal power |
| wet bulb / dew point | Feuchtkugeltemperatur / Taupunkt | limits of evaporative cooling / condensation |
| P&ID | R&I-Fließschema | piping and instrumentation diagram (`pid.png`, DEXPI) |
| digital twin | digitaler Zwilling | here: the causal model of the three parts |
| causal graph | Kausalgraph | parents and lags of each variable (`causal_graph.json`) |
| driver | Treiber, Eingangsgröße | variable taken from the data (`drivers`) |
| lever, setpoint | Stellgröße, Sollwert | what an operator changes (`levers`, `Cool_Set`) |
| free run | freier Lauf, Simulation | the twin on its own predictions ([evaluation](modelling/evaluation-and-pitfalls.md)) |
| grey-box / semi-physical | Grey-Box, halbphysikalisch | physics structure, fitted coefficients (`phys`) |
| bronze / silver | – | the user's delivered data / the app's derived files (`app/backend/core/storage.py`) |

## Abbreviations

| Abbrev. | Meaning |
|---|---|
| PUE, ERF, ERE, WUE, REF, CUE | data center KPIs ([metrics](datacenter/metrics.md)) |
| CDU, TCS, FWS | coolant distribution unit, technology cooling system, facility water system |
| D2C, DLC | direct-to-chip, direct liquid cooling |
| HAC, CAC | hot / cold aisle containment |
| 3GDH, 4GDH, LTDH, 5GDHC | district heating generations ([temperatures](temperatures/district-heating-and-heat-pumps.md)) |
| SCM | structural causal model |
| PCMCI, PC, ParCorr | causal discovery methods ([causal graphs](modelling/causal-graphs.md)) |
| nMAE, RMSE, R² | error metrics |

## See also

- [Index](index.md) · [App map](app/app-map.md)

## Sources

- EN 50600-1 (terms); DIN EN 12831-1; VDI 4710; BDEW SLP Leitfaden; ASHRAE TC 9.9; Lund et al. 2014 (4GDH); Buffa et al. 2019 (5GDHC).
