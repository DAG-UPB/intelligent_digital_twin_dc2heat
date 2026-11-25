---
title: Matching sim_recovery_air with sim_district_heat in Heat Matching
tags: [datasets, how-to, heat-matching, sim_recovery_air, sim_district_heat, drivers, click-path, mcp]
summary: Step-by-step click path (and the MCP ui_do equivalent) to run the recovery data center's trained model on the separate district's weather and demand, and the numbers of its own demand to compare with.
---

# Matching *Recovery · air cooled* with *District · heat demand*

The two are **separate simulations**. `sim_recovery_air` is a 5 MW data center in Frankfurt giving ~38,000 MWh/a of heat (IT,
cooling, electrical losses and the building; PUE 1.21), of which 27,483–28,472 MWh/a are recovered: the hall's heat up to the
loop's 4,333 kW, as far as the loop's cold pipe (`Loop_T_cold`, an input) lets it: all of it in winter, ~68 % in summer, when the
pipe warms to ~20 °C. Its own `Heat_Demand` input (~30,000 MWh/a, a seasonal district: in January ~1.5 × the heat pump's ~4.8 MW, in summer ~0.65 MW) drives no data-center column; what the district uses of the heat, hour by hour, is Heat Matching's.
`sim_district_heat` is a district of ~500–900 dwellings on its own weather, ~5,400–5,600 MWh/a. Heat Matching can
feed the district's weather into the data center's trained model as a **driver** and its demand into the matching (see [simulate](../modelling/simulate-and-drivers.md)).

## Click path (from `docs/user-guide.md`, section 8)

1. Top bar: **Intelligent Digital Twin** › **Heat Matching** (`#/twin/matching`).
2. **Systems** (right of the sub-tabs) › **Data center**: **Recovery · air cooled**.
3. The data center's folder at the top right of its box (*Data center: model and system*) › **Trained model · XGB ·
   Causal graph** (`xgb`).
   `phys` also works; `linear` follows the recovery and the plant behind it poorly (free-run R² of `HEX_Hall_Q` 0.801).
4. **What if…** › **Weather from** › **District · heat demand**.
5. **What if…** › **Heat demand from** › **District · heat demand**.
6. Read the KPI tiles (coverage, heat delivered, heat-pump electricity, SPF, **CO₂ saved**), the year chart and the flow diagram.

Variant: without steps 4–5 the page matches against the data center's **own** `Heat_Demand`, run by the district
structure's `xgb` (`silver/district_structure/site.json` `twin_model`); *Case 1 · Recovery, trained models* sets
`xgb` for both.

## Same thing through MCP (agent)

1. Ask the user to press **Connect AI** and give you the six-digit code, then call `connect_app`.
2. `ui_do` `navigate` `{route: "twin/matching"}`, then `ui_do` `open_dataset` `{dataset: "sim_recovery_air"}`.
3. `ui_snapshot` to read the control names. Then `ui_do` `fill` *Data center: model and system* (the trained model),
   `click` *What if…*, `fill` *Weather from*, *Heat demand from*, by the names the snapshot lists (they can change; do
   not hard-code them).
4. `ui_snapshot` again to read the KPIs. Without the page, the same computation is `simulate` with
   `drivers: {"Out_Temp": [...]}` on model `xgb` of `sim_recovery_air` (the district's series from `get_data` of `sim_district_heat`;
   `Heat_Demand` is no driver of the data center: it only sets what the heat distribution has to match).

## What to expect

With the data center's **own** demand (2024, data center and district on `xgb`, 5 MW heat pump `hp_5mw`, `storage_tank`,
70 °C supply; measured in the app): coverage **75.8 %**, 22,737 of 30,013 MWh delivered, 7,276 MWh unmet, 8,532 MWh
surplus, 4,338 MWh heat-pump electricity, SPF 5.24, ~3,430 t CO₂ saved against gas. The rest falls in winter (in January
the demand is ~1.5 × the heat pump's ~4.8 MW); in summer the district needs ~0.65 MW of the data center's ~3.7. The heat
pump lifts from the hall water (~30 °C, `site.json` `source.temp_c`), not from the loop's cold pipe: its COP is an upper bound.
The district's own models (free run over 2024, R² of `Heat_Demand`): `xgb` 0.993, `phys` 0.983, `linear` 0.881.

With `sim_district_heat` put in (the small district, sized for the 750 kW case), the demand is 5,354–5,566 MWh/a
against 27,991–29,134 MWh/a recovered, far below the data center's heat. The recovered heat itself does not follow the weather:
it hangs on the IT load, the hall and the loop's cold pipe (an input that keeps its own series); the outdoor temperature reaches
the free cooling, the cooling electricity, the building and the rejected heat. No numbers for this pairing have been measured since the example was regenerated.
See [seasonality](../recovery/heat-matching.md#seasonality).

## Checks if the numbers look wrong

- Both series must cover the period. `onPeriod` returns null otherwise, and the page falls back to its own inputs.
- The data-center model must have `Out_Temp` as a driver (it does in the shipped `linear`/`phys`/`xgb`); `Heat_Demand` is not one. A retrained model with another graph may differ.
- Supply temperature: the district's `supplyTemp` (default 70 °C) sets the COP. A ~30 °C source (the hall water) always needs the heat pump.
- The examples are re-added to every project; regenerate them only with the scripts (see [datasets](examples.md)).

## See also

- [The example datasets](examples.md)
- [Heat matching](../recovery/heat-matching.md) · [Heat pumps and storage](../recovery/heat-pumps-and-storage.md)
- [App map for agents](../app/app-map.md)

## Sources

- `app/examples/recovery_air_cooled/README.md`, `app/examples/district_heat_demand/README.md`, `docs/concepts/simulated-heat-recovery.md`, `docs/user-guide.md`.
