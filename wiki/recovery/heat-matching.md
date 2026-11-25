---
title: Heat recovery and matching (supply vs demand, coverage, surplus, CO2, seasonality)
tags: [heat-recovery, matching, coverage, surplus, unmet, storage, heat-pump, co2, seasonality, kpi]
summary: How the app matches the data center's waste heat against the district demand step by step (matchHeat), the KPIs it reports, the CO2 factors, and why the seasons decide everything.
---

# Heat recovery and matching

The question is: in each step, how much of the district's demand can the data center's heat cover,
and at what cost in heat-pump electricity? The answer is computed in the browser by
`matchHeat` in `app/web/src/lib/matching.ts` (pure, tested in `matching.test.ts`).

## The algorithm (`matchHeat`), per step

Inputs: source heat `q` (kW) and temperature `t` (°C), demand (kW), network supply temperature, `MatchOptions`, step length.

1. **Usable heat**: physics on → `q · hexEff` (0.9); physics off → `q · eta` (0.8).
2. **Path** (`recovery`: `direct | heatpump | auto | none`, default `auto`):
   - direct is possible when `t ≥ supply + approach` (physics on, approach 5 K), always with physics off;
   - `auto` uses the heat pump only when direct is not possible.
3. **COP**: `carnotCop(t, supply, carnotEff)` (η_C 0.5, clamped 1.1–8) or `fixedCop` 3.5 with physics off.
4. **Potential**: heat pump `min(hpCapacity, usable · COP / (COP − 1))` (default 150 kW); direct = HEX heat.
5. **Tank** (default 500 kWh, loss 0.1 %/h, as Operation's): the level decays; the deficit is drawn from it; surplus charges it up to capacity.
6. **Results** per step: `direct`, `hp`, `hpElec = produced / COP`, `charge`, `fromTank`, `tankLevel`, `unmet`, `surplus`, `drawn`.

A component can replace the built-in formula per part (`PartSeries`: `hpCop`, `hpCap`, `hexQ`, `hexTOut`,
`tankKwh`, `tankLossPct`). Set it in `site.json` `heat_components`; see `docs/concepts/components.md`.

## KPIs

| Total (`r.totals`) | Meaning |
|---|---|
| `demandMwh` | district demand over the period |
| `deliveredMwh` | direct + heat pump + tank → demand |
| `coveragePct` | delivered / demand |
| `dcUsedPct` | data center heat drawn / heat offered |
| `hpElecMwh`, `spf` | heat pump electricity; SPF = heat-pump heat / its electricity |
| `unmetMwh`, `surplusMwh` | demand not covered; heat the path could give but nobody took |
| `hoursCovered` / `demandHours` | hours with a demand fully met / hours with a demand (`hours`: the period's) |

`app/web/src/lib/partKpis.ts`:

- heat distribution: **COP** `ΣQ_hp / ΣP_el_hp`; **waste heat used** `Σ(Q_hex + Q_hp − P_el_hp) / ΣQ_dc`; electricity use;
- district: **demand covered**; energy used; **CO₂ saved**.

**CO₂ saved** = `delivered · 0.201 / 0.9 − hpElec · 0.38` (t from MWh, `co2SavedT`), from these factors:

| Factor | Value | Source |
|---|---|---|
| Natural gas | 0.201 kg CO₂/kWh fuel | UBA CO₂ emission factors 2022 |
| Gas boiler seasonal efficiency | 0.9 | assumption |
| German grid electricity | 0.38 kg CO₂/kWh | UBA Strommix 2023 (~380 g/kWh) |

These are fixed (a `ponytail:` note says a site's own factors would go there as settings).

### CO₂ as forest (Site map's Quick analysis)

Under its CO₂ saved the Quick analysis shows the trees that take up as much in a year and, on demand, the forest they
make, drawn as soccer fields of 105 × 68 m (0.714 ha, FIFA's recommended pitch) in the Frankfurter Stadtwald (a site
within 25 km of it), else in the nearest forest, or where the user clicks (`app/web/src/pages/district/trees.ts`,
`TreeGrove.tsx`):

| What | Formula | Factors |
|---|---|---|
| Trees | CO₂ t × 1000 / 20 kg | 20 kg CO₂ per grown tree a year, the middle of ~10–30 kg (`lib/heatFacts.ts` `TREE_KG`) |
| Forest | ha = CO₂ t / 12.5 | a hectare grows 8.9 m³ of wood a year (BWI 2022 Hessen) × ~1.4 t CO₂ per m³ = 12.5 t; ~620 trees per ha follow from the two |

`sim_recovery_air` on the map (21,957 MWh delivered, 2,836 t CO₂; 2026-11-24): ~140,000 trees = ~230 ha = ~320 fields.
Above 2,500 fields the block is one area; above 4,800 ha (`STADTWALD_HA`) the caption says it is more than the whole
Stadtwald. No CO₂ saved: no trees.
Human docs:
`docs/concepts/district-demand.md` (Forest equivalents).

## Seasonality

The data center's heat is a near-flat base load. The district's demand is not:

| Season | Residential demand vs annual mean | What happens |
|---|---|---|
| Winter (Dec–Feb) | 1.5–2.5 × | demand > supply: high coverage of the DC heat, unmet demand needs another source (boiler, CHP) |
| Spring/autumn | ~1 × | best match |
| Summer (Jun–Aug) | 0.15–0.3 × (hot water only) | large surplus: heat goes to the tower |

Consequences:

- Annual coverage and the share of DC heat used are both limited. If the DC heat ≈ annual demand, typical
  coverage is only 40–60 %, because winter peaks exceed supply and summer surplus is wasted.
- **Storage** fixes hours to days (day/night, weekend). A tank of hours does nothing against the season.
  Seasonal storage (pit, borehole, aquifer: 10,000–100,000+ m³) would be needed for that.
- Better sinks for the summer: hot water, industry with constant demand, absorption cooling, 5G loops with cooling customers.
- Size the recovery for the summer base (hot water) to use it fully. Size it for the winter to cover more, and accept surplus in summer.

Example (`sim_recovery_air` with its own district demand, 2024, both on `xgb`, 5 MW heat pump `hp_5mw`, tank, 70 °C supply,
`docs/concepts/simulated-heat-recovery.md`): 75.8 % of 30,013 MWh covered, 8,532 MWh surplus, SPF 5.24, ~3,430 t CO₂ saved;
the rest in winter. Share of the hall's heat recovered: all of it in winter, ~68 % in summer (the loop's cold pipe warms).

## Two estimates of the source

- **Data / Model**: the dataset's `heat_source` columns. In the sims these are the demand-limited **recovered** heat.
- **Calculation** (`physicsSource`): the heat **available** with no demand limit, from `ITE_Ener`, `HVAC_Ener`,
  `In_Temp`, `Out_Temp`. It is higher than the data, mostly in summer. See `docs/concepts/heat-distribution.md`.

## In this app

- Page: Intelligent Digital Twin › Heat Matching (`#/twin/matching`, `app/web/src/pages/twin/HeatDistributionPage.tsx`).
- External weather/demand from another dataset: `app/web/src/lib/externalInputs.ts`. These are passed as `drivers` to `simulate`.
- Site map quick estimate: `app/web/src/pages/district/quickAnalysis.ts`; its forests: `app/web/src/pages/district/trees.ts`.
- Site map heat network (route, sizes, NPV): [heat-network planning](heat-network-planning.md).

## See also

- [Heat pumps and storage](heat-pumps-and-storage.md)
- [Heat-network planning on the Site map](heat-network-planning.md)
- [Heat demand profiles](../profiles/heat-demand-profiles.md)
- [Recovery and district example, click path](../datasets/recovery-and-district.md)
- [Metrics](../datacenter/metrics.md)

## Sources

- Umweltbundesamt: CO₂-Emissionsfaktoren für fossile Brennstoffe (2022); Entwicklung der spezifischen CO₂-Emissionen des deutschen Strommix (2023).
- M. Wahlroos et al.: "Future views on waste heat utilization: case of data centers in Northern Europe", Renew. Sustain. Energy Rev. 82, 2018.
- X. Yuan et al.: "Waste heat recoveries in data centers: a review", Renew. Sustain. Energy Rev., 2023 (ERF of real schemes 0.1–0.6).
- Commission Delegated Regulation (EU) 2024/1364 (only used heat counts as reused).
- Forests: Arbor Day Foundation (48 lb CO₂ a tree a year); Bundeswaldinventur 2022, "BWI4 Daten Hessen" (2024); LWF Merkblatt 12, Energiegehalt von Holz (2024); Stadt Frankfurt, Waldzustandsbericht 2024; FIFA, Football Stadiums: Technical Recommendations and Requirements; IFAB Laws of the Game, Law 1.
