# Simulated heat recovery (`sim_1_modified`, `sim_1_air`, `sim_1_water`)

*Simulation 1 · with heat exchangers* (`sim_1_modified`) is `sim_1` plus a heat demand and two heat-recovery exchangers (HEX). `app/scripts/make_sim_1_modified.py` computes them hour by hour from the sim_1 data. Each HEX has **four columns, all on its hot (heat-source) side**: the inlet temperature $T_{in}$, the outlet temperature $T_{out}$, the mass flow $\dot m$ and the recovered heat $Q$. Three are variables of the twin; $Q$ is calculated from them. The data satisfy the energy balance exactly:

$$
Q = \dot m \, c_p \, (T_{in} - T_{out})
$$

with a constant specific heat from the literature: air for the hall HEX and water for the condenser HEX. An exchanger delivers heat only when something uses it. This page lists the equations, the parameters and their sources, and what the model leaves out.

**$Q$ is calculated, not modelled.** The data keep all four columns, but $Q$ follows from the other three by the energy balance, so it is a **derived** column (`dataset.json` → `derived`). It is not a node of the causal graph and never a model target or input. The twin predicts $T_{in}$, $T_{out}$ and $\dot m$, and wherever the app needs a predicted $Q$ (the *Model* series of Heat Distribution, a plotted $Q$ in the Scenarios test-period simulation) it computes it from them with the same formula (`backend/core/derived.py`, `web/src/lib/sourceMap.ts` → `derivedQ`). The demand limit therefore shows in $T_{out}$: the less heat is used, the less the hot side is cooled.

The two exchangers are the two **design options** of `site.json` → `hex_option`, the HEX highlighted on the Structure and Modelling page. Each set of columns shows what that option would recover if it alone served the demand, so the two must not be added up. The Structure and Modelling page, the Scenarios causal map and the Scenarios signal and intervention lists show only the selected option's **three** variables, $T_{in}$, $T_{out}$ and $\dot m$. The drawing shows the selected HEX's $Q$ as a small read-out next to it ("Q = ṁ·cₚ·ΔT", with its mean over the data and $c_p$). The other option's variables are hidden there, not deleted. The Dashboard keeps $Q$ in its statistics table, marked *calculated*, and its ERF counts only the selected option.

## Causality: everything one hour later

Every new value of hour $t$ is computed from the values of hour $t-1$ (`df.shift(1)`; the first hour repeats the second). Every new link in the causal graph therefore has a lag of at least 1, as the graph rules require (see {doc}`causal-graph`). Below, $x$ means $x_{t-1}$ unless a subscript says otherwise. The energy balance is the only same-hour relation. It ties the four columns of one HEX together; it is not a causal link, which is why $Q$ is calculated rather than a graph node.

## Columns

| Column | Unit | What | min / mean / max (2023–2024) |
|---|---|---|---|
| `Heat_Demand` | kW | Heat demand of the recovery loop (the low-temperature network or heat-pump source it feeds) | 2.0 / 19.2 / 185.9 |
| `HEX_Hall_T_in` | °C | Air into the hall HEX: hot-aisle return air | 31.8 / 37.7 / 41.0 |
| `HEX_Hall_T_out` | °C | Air leaving the hall HEX, on to the CRAH chilled-water coil | 27.7 / 34.3 / 40.6 |
| `HEX_Hall_m` | kg/s | Air mass flow through the hall HEX | 0.11 / 3.17 / 5.19 |
| `HEX_Hall_Q` | kW | Heat recovered by the hall HEX (demand-limited), **calculated** | 0.4 / 10.7 / 49.7 |
| `HEX_Cond_T_in` | °C | Condenser water leaving the chiller, into the plate HEX | 27.2 / 32.7 / 48.0 |
| `HEX_Cond_T_out` | °C | Condenser water leaving the plate HEX, on to the cooling tower | 27.0 / 31.1 / 47.8 |
| `HEX_Cond_m` | kg/s | Condenser water mass flow | 1.96 / 2.14 / 3.83 |
| `HEX_Cond_Q` | kW | Heat recovered by the condenser HEX (demand-limited), **calculated** | 1.4 / 13.9 / 63.7 |

`dataset.json` → `heat_source` lists the four columns of each option as `{q, t_in, t_out, m}`, plus `t` (= `t_in`), the source temperature that {doc}`heat-distribution` uses. `dataset.json` → `derived` declares each $Q$ as calculated from its parts, with the literature $c_p$ in kJ/(kg·K):

```json
"derived": {
  "HEX_Hall_Q": {"m": "HEX_Hall_m", "t_in": "HEX_Hall_T_in", "t_out": "HEX_Hall_T_out", "cp": 1.006},
  "HEX_Cond_Q": {"m": "HEX_Cond_m", "t_in": "HEX_Cond_T_in", "t_out": "HEX_Cond_T_out", "cp": 4.18}
}
```

`dataset.json` → `kpi` names IT power, cooling power, the heat demand and the reused heat per option (`reuse`) for the Dashboard.

## Heat demand

The demand comes from the district generator of {doc}`district-demand` (`web/src/lib/demand.ts`), ported to Python with its default parameters. These are a heating limit of 15 °C, a hot-water share of 0.2, a morning peak of 0.6, an evening peak of 0.5, a night set-back of 0.3, a weekend factor of 1.05, and the morning shifted 2 h later at weekends:

$$
\mathrm{Heat\_Demand}_t = S\left[(1-f_{dhw})\,\frac{\max(0,\ T_{lim} - \overline{T}^{24h}_{out,t})\; h_{heat}(\tau_t)}{\overline{(\cdot)}} + f_{dhw}\,\frac{h_{dhw}(\tau_t)}{\overline{(\cdot)}}\right]
$$

$\overline{T}^{24h}_{out,t}$ is the mean outdoor temperature of hours $t-24 \ldots t-1$, the slow response of the buildings. $\tau_t$ is the clock hour of $t$; it is known in advance from `Hour[t-1]`. $h_{heat}$ and $h_{dhw}$ are the daily curves of `demand.ts`. Each bar term is divided by its mean over the file, and $S$ is the mean demand.

**Demand share.** $S = 0.5 \cdot \overline{\mathrm{ITE\_Ener}}$: the year's demand is half the year's IT heat (167 MWh/a, for example 24 apartments at 7 000 kWh/a). Real data-center heat-reuse schemes reach an annual ERF of about 0.1 to 0.6 (Yuan et al. 2023), and 0.5 sits in that range. The sim_1 climate is warm (summer mean about 30 °C), so the demand is very seasonal. In winter (December to February) it averages 44 kW, more than either HEX gives on average (19 kW from the hall coil, 28 kW from the condenser). In summer, with hot water only, it averages 4 kW. So the demand limit binds in part of the year, as intended: in 81 % of the hours for the condenser HEX and in 72 % for the hall HEX. In the other hours the exchanger's own limit applies.

In the graph, `Heat_Demand` has the parents `Out_Temp`, `Hour` and its own past. The self-link stands for the 24 h mean, which is the buildings' memory.

The HEX nodes and their parents (all at lag 1; the lag-discovered graphs keep the links and learn lags 1–5):

| Node | Parents | Why |
|---|---|---|
| `HEX_Hall_T_in` | `In_Temp` | return air = inlet + server ΔT |
| `HEX_Hall_m` | `ITE_Ener` | air flow sized for the IT heat |
| `HEX_Hall_T_out` | `ITE_Ener`, `In_Temp`, `Heat_Demand` | $T_{in}$ and $\dot m$ through their causes, and the demand limit |
| `HEX_Cond_T_in` | `Out_Temp`, `Out_Hum`, `ITE_Ener`, `HVAC_Ener` | tower water (wet bulb) + condenser heat |
| `HEX_Cond_m` | `ITE_Ener`, `HVAC_Ener` | pump flow for the condenser heat |
| `HEX_Cond_T_out` | `Out_Temp`, `Out_Hum`, `ITE_Ener`, `HVAC_Ener`, `Heat_Demand` | $T_{in}$ and $\dot m$ through their causes, and the demand limit |

$T_{out}$ depends on $T_{in}$ and $\dot m$ of the **same** hour. Links start at lag 1 (see {doc}`causal-graph`), so the graph gives $T_{out}$ the lag-1 causes of $T_{in}$ and $\dot m$ instead of a same-hour link to them.

## Hall HEX: air-to-water coil in the CRAH return air

The hot side is **air**:

$$
\begin{aligned}
T_{in,t} &= \mathrm{In\_Temp} + \Delta T_{srv} &&\text{hot-aisle return air} \\
\dot m_t &= \mathrm{ITE\_Ener} / (c_{p,air}\, \Delta T_{srv}) &&\text{air flow sized for } \Delta T_{srv} \\
Q^{max}_t &= \varepsilon_{air}\, \dot m_t c_{p,air}\, \max(0,\ T_{in,t} - T_{sink}) &&\varepsilon\text{-NTU, air is } C_{min} \\
Q_t &= \min\left(Q^{max}_t,\ \mathrm{Heat\_Demand}\right) &&\text{only heat that is used} \\
T_{out,t} &= T_{in,t} - Q_t / (\dot m_t c_{p,air}) &&\text{air leaving the coil}
\end{aligned}
$$

The CRAH chilled-water coil cools the air the rest of the way, from $T_{out}$ down to the supply set-point. Every kW the hall coil recovers is therefore a kW the chiller does not have to remove. sim_1's `HVAC_Ener` does not include this saving (see the limits below).

## Condenser HEX: plate HEX between chiller and cooling tower

The hot side is **water**:

$$
\begin{aligned}
Q^{cond}_t &= \mathrm{ITE\_Ener} + \mathrm{HVAC\_Ener} &&\text{IT heat + chiller electricity} \\
T_{wb,t} &= \mathrm{Stull}(\mathrm{Out\_Temp},\ \mathrm{Out\_Hum}) &&\text{wet bulb, Stull (2011)} \\
T_{cw,t} &= \max\left(T_{wb,t} + \Delta T_{app,tower},\ T_{cw,min}\right) &&\text{water from the tower into the chiller} \\
\dot m_t &= \max\left(Q^{cond}_t,\ f_{min} Q^{cond}_{design}\right) / (c_{p,w}\, \Delta T_{cond,design}) &&\text{variable-speed pump, minimum flow} \\
T_{in,t} &= T_{cw,t} + Q^{cond}_t / (\dot m_t c_{p,w}) &&\text{water leaving the chiller} \\
Q_t &= \min\left(\varepsilon_{plate}\, \dot m_t c_{p,w} (T_{in,t} - T_{sink}),\ Q^{cond}_t,\ \mathrm{Heat\_Demand}\right) \\
T_{out,t} &= T_{in,t} - Q_t / (\dot m_t c_{p,w}) &&\text{on to the tower}
\end{aligned}
$$

The condenser pump holds the design range of 5.5 K and turns down to half the design flow. Below that load the range shrinks, which is why $\dot m$ sits at its minimum in 54 % of the hours. On sim_1 the plate limit never binds: the condenser HEX is limited only by the condenser heat (19 % of the hours) or the demand. When it takes all the heat, $T_{out} = T_{cw}$ and the tower idles. Recovery at the condenser does not reduce the chiller's load; it reduces the tower's load and its water use.

The Stull formula, valid for 5–99 % RH and −20 to 50 °C, ±0.3 K:

$$
T_{wb} = T\,\mathrm{atan}\!\left(0.151977\sqrt{RH + 8.313659}\right) + \mathrm{atan}(T + RH) - \mathrm{atan}(RH - 1.676331) + 0.00391838\,RH^{3/2}\,\mathrm{atan}(0.023101\,RH) - 4.686035
$$

## Parameters and sources

| Parameter | Value | Literature | Source |
|---|---|---|---|
| $c_{p,air}$, specific heat of air | 1.006 kJ/(kg·K) | dry air, constant within 0.1 % over 0–50 °C | ASHRAE Handbook—Fundamentals (2021), ch. 1 Psychrometrics |
| $c_{p,w}$, specific heat of water | 4.18 kJ/(kg·K) | 4.180 at 30 °C, 4.179–4.182 over 20–50 °C | IAPWS-95: Wagner & Pruß, [J. Phys. Chem. Ref. Data 31 (2002) 387](https://doi.org/10.1063/1.1461829) |
| $\Delta T_{srv}$, air rise across the servers | 12 K | 10–15 K typical, up to 20 K for dense gear; $V = P/(1.2 \cdot 1.005 \cdot \Delta T)$ | AKCP, [Delta T demystified](https://www.akcp.com/2023/06/09/optimizing-data-center-efficiency-understanding-and-managing-delta-t/); Upsite, [The primary data center delta Ts](https://upsite.com/?p=206932) |
| Server inlet (`In_Temp`, 19.8–29 °C in sim_1) | from the data | 18–27 °C recommended, 15–32 °C allowable (A1) | ASHRAE TC 9.9, [Thermal Guidelines, 5th ed. reference card](https://www.ashrae.org/file%20library/technical%20resources/bookstore/supplemental%20files/therm-gdlns-5th-r-e-refcard.pdf) (2021) |
| Hot-aisle return air $T_{in}$ (31.8–41 °C) | In_Temp + 12 K | 27–35 °C typical, 25–47 °C reported | Yuan et al., [Waste heat recoveries in data centers: a review](https://doi.org/10.1016/j.rser.2023.113777), RSER 188 (2023) 113777, sec. 7.1 |
| $\varepsilon_{air}$, air coil effectiveness | 0.6 | 0.5–0.75 for a 2–4 row counter-flow coil; air ΔT 3–8 K; coil approach 3–7 K | ε-NTU with the approach of Google patent [US10551079](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10551079) "Warm water cooling" (6.8 K); Yuan et al. 2023 |
| $T_{sink}$, return water of the heat sink | 25 °C | 20–27 °C (heat-pump evaporator, low-temperature loop); water ΔT 4–6 K | Stockholm Data Parks / Fortum Värme, [white paper](https://stockholmdataparks.com/wp-content/uploads/white-paper-cost-efficient-and-sustainable-data-center-cooling-2017-01-23-1.pdf) (2017); EN 14511 (W10/W35) |
| $\Delta T_{app,tower}$, tower approach to wet bulb | 4 K | 3.9 K at the CTI rating point (35/29.4/25.6 °C), 2.8 K practical minimum | Deppmann, [Water-side economizers part 3](https://www.deppmann.com/wp-content/uploads/2023/05/RLD_MMM_5_22_23_WaterSide_Economizers_Part3_Cooling_Tower_Temperatures-1.pdf) (2023); Delta Cooling Towers, [Sizing & selecting](https://deltacooling.com/attachments/News/164/includable/Sizing-Selecting-09-2020.pdf) |
| $T_{cw,min}$, condenser water floor | 27 °C | chiller minimum ECWT ~18–21 °C; AHRI rating 29.4 °C | AHRI [Standard 550/590](https://www.ahrinet.org/system/files/2023-06/AHRI%20Standard%20550-590%202020%20%28I-P%29%20with%20Addendum%201.pdf) (2020). Chosen above the sink return: in heat-recovery operation the tower bypass holds the water warm enough to heat the 25 °C return |
| $\Delta T_{cond,design}$, condenser range | 5.5 K | 29.4 → 35 °C (85/95 °F), 3.0 gpm/ton | AHRI 550/590 |
| $Q^{cond}_{design}$ | 90 kW | sized for the peak of ITE + HVAC in sim_1 (88 kW); design flow 3.9 kg/s | design choice |
| $f_{min}$, minimum condenser flow | 0.5 of design | variable-flow hydronic systems turn down to 50 % of design flow or less | ASHRAE Standard 90.1-2019, 6.5.4.2 |
| $\varepsilon_{plate}$, plate HEX effectiveness | 0.8 | approach 1–3 K, ε 0.8–0.9 | Deppmann, [Water-side economizers part 8: HEX approach](https://www.deppmann.com/wp-content/uploads/2023/07/Waterside_Economizers_Part8_Heat_Exchanger_Approach.pdf) (2023); AHRI Standard 400 |
| Condenser water as a heat source | 30–35 °C, 40–50 °C when run hot | (sim: 27–48 °C) | Yuan et al. 2023, Table 1 |
| Demand limit $Q = \min(Q^{max}, \text{demand})$ | — | only heat actually used outside the data center counts as reused | [EU Delegated Regulation 2024/1364](https://eur-lex.europa.eu/eli/reg_del/2024/1364/oj/eng), Annex II 1(j) |
| Demand shape | `demand.ts` defaults | 4GDH 55/25 °C, 5GDH 10–40 °C | Lund et al., [4th generation district heating](https://doi.org/10.1016/j.energy.2014.02.089), Energy 68 (2014); IRENA, [Fourth-generation DHC](https://www.irena.org/Innovation-landscape-for-smart-electrification/Power-to-heat-and-cooling/8-Fourth-generation-DHC-systems) |
| Wet bulb | Stull (2011) | — | Stull, [Wet-bulb temperature from relative humidity and air temperature](https://doi.org/10.1175/JAMC-D-11-0143.1), J. Appl. Meteor. Climatol. 50 (2011) 2267–2269 |

**Air or water: it matters.** An air coil has a poor air-side heat-transfer coefficient. It needs a larger approach (3–7 K against 1–3 K for a plate HEX) and reaches a lower effectiveness (0.5–0.75 against 0.8–0.9). It can cool the air only toward the water inlet, so it never takes all the IT heat. The specific heats differ too: a kilogram of water carries about four times the heat of a kilogram of air per kelvin. That is why the hall coil needs about 3 kg/s of air where the condenser HEX needs about 2 kg/s of water. The hall coil also sits in the air stream all the time and adds 50–150 Pa of fan pressure, about 1–1.5 % of the IT power at 100 Pa. The plate HEX adds only pump head. In return, the hall coil removes heat before the chilled-water coil, which lowers the chiller load directly. The condenser HEX also takes the compressor work, $Q^{cond} = Q_{IT} + P_{HVAC}$, and sees steadier temperatures, so Yuan et al. (2023) recommend condenser coolant as the source. Both sources are low-grade, about 28–34 °C: they can feed a 5GDH network or a heat-pump evaporator directly, but a 4GDH network (50–60 °C) needs a heat pump (see {doc}`heat-distribution`).

## Sanity checks

`check()` runs on every generated file, and `tests/test_scripts.py` runs on synthetic input. They check:

- the energy balance $Q = \dot m\, c_p\, (T_{in} - T_{out})$ for both HEX, and that the `derived` declaration computes the $Q$ columns back;
- $0 \le Q \le$ the demand of the previous hour, and $Q \le \varepsilon\, \dot m c_p (T_{in} - T_{sink})$;
- $T_{out} < T_{in}$ whenever $Q > 0$ (equal when $Q = 0$), and $T_{out}$ above the 25 °C sink return;
- plausible ranges all year: return air 27–47 °C, condenser water 27–50 °C, the condenser range at most the design 5.5 K, the condenser HEX never taking more than the condenser heat (water never colder than from the tower), and a demand above zero (hot water all year).

## Physics equations

`equations.json` holds the same formulas in the equation language (see {doc}`models`), with the fixed constants written in. Every term is from the previous hour, like the data, so the *phys* model has no same-hour input either: $\dot m$ and $T_{in}$ are written out inside the $T_{out}$ equation, so the three equations of one HEX share their inputs, and $Q$, calculated from them, keeps the energy balance. $Q$ has no equation. The *phys* model learns only $\Delta T$, $\varepsilon_{air}$ and the tower approach, and on sim_1_modified it learns them back exactly ($\Delta T_{srv} = 12$, $\Delta T_{cond} = 5.5$, $\varepsilon_{air} = 0.6$, approach 4 K). The plate limit is left out of the equations: the tower bypass keeps the water at least 2 K above the sink return and the range at most 5.5 K, so $\varepsilon_{plate}(T_{in} - T_{sink}) \ge 0.8\,(\Delta T + 2) \ge \Delta T$ and the limit can never bind. `Heat_Demand` has no equation; it uses linear regression on its parents.

## Model accuracy

Free-run nMAE on the test half (2024, split 0.5, max lag 5, graph `causal_graph_pcmci.json`) after retraining every model. The models predict $T_{in}$, $T_{out}$ and $\dot m$; the two $Q$ rows are **calculated** from the free run's predicted parts with $Q = \dot m\, c_p\, (T_{in} - T_{out})$ (TabPFN: its first 720 h):

| Variable | linear | linear_all | xgb | xgb_all | phys | sym | tabpfn |
|---|---|---|---|---|---|---|---|
| `Heat_Demand` | 0.591 | 0.582 | 0.185 | 0.184 | 0.591 | 0.657 | 0.617 |
| `HEX_Hall_T_in` | 0.006 | 0.006 | 0.008 | 0.009 | 0.008 | 0.006 | 0.004 |
| `HEX_Hall_T_out` | 0.049 | 0.045 | 0.024 | 0.025 | 0.066 | 0.049 | 0.010 |
| `HEX_Hall_m` | 0.088 | 0.088 | 0.082 | 0.070 | 0.089 | 0.081 | 0.092 |
| `HEX_Hall_Q` (calculated) | 0.488 | 0.440 | 0.236 | 0.235 | 0.690 | 0.492 | 0.238 |
| `HEX_Cond_T_in` | 0.052 | 0.049 | 0.009 | 0.014 | 0.007 | 0.049 | 0.011 |
| `HEX_Cond_T_out` | 0.051 | 0.046 | 0.013 | 0.017 | 0.031 | 0.050 | 0.006 |
| `HEX_Cond_m` | 0.061 | 0.072 | 0.027 | 0.040 | 0.029 | 0.059 | 0.012 |
| `HEX_Cond_Q` (calculated) | 0.586 | 0.483 | 0.228 | 0.214 | 0.635 | 0.551 | 0.309 |

The causal graph is as good as all-vs-all for each learner. Temperatures and flows are easy (nMAE ≤ 0.09). The heat $Q$ is hard, although its parts are not: $Q$ is $\dot m\, c_p$ times the **small** difference $T_{in} - T_{out}$ (1.6 K on average at the condenser), so a small error in $T_{out}$ is a large one in $Q$. $T_{out}$ itself switches between two limits, the exchanger and the demand, and the demand follows a daily curve that a linear model on `Hour` cannot draw. The tree models get the demand to an nMAE of 0.18 and $Q$ to about 0.22; calculating $Q$ from the predicted parts costs them at most 0.02 against the former direct $Q$ targets (0.21–0.23). *phys* has the exact formulas, but inherits the linear demand's free-run error through the $\min(\cdot)$.

## Limits

- **`HVAC_Ener` does not see the recovery.** It is sim_1's EnergyPlus cooling electricity, drawn on the chiller. The hall coil's fan penalty (+50–150 Pa) and its chiller saving are not in it, and neither is the COP cost of the 27 °C condenser floor (about 2–3 % per K).
- **All cooling heat passes the condenser loop.** In winter this assumes a water-side economiser, so that the heat still reaches the condenser water.
- **Constant effectiveness and specific heats.** There is no NTU change at part flow and no thermal storage; $c_p$ is a constant (it varies by less than 0.3 % over 20–50 °C).
- **Only the hot side is modelled.** The sink's water flow and outlet temperature are not columns; the sink return $T_{sink}$ enters only through the exchanger limit.
- **The demand is the recovery loop's own.** Heat Distribution matches the recovered heat against the district demand of `site.json` once more. *From physics* on that page is a simpler estimate of the **available** heat with no demand limit, so it does not reproduce these columns.
- **sim_1's weather has hot and humid hours.** Some hours reach 39 °C at 96 % RH, a wet bulb up to 38 °C. In those hours the condenser water rises to about 48 °C. That is high, but it is within the 40–50 °C reported for condensers run hot.

## Plant cases with free cooling (`sim_1_air`, `sim_1_water`)

Real plants are not built the way `sim_1_modified` assumes: every one has **free cooling**, and its chiller runs only when the weather needs it. The outdoor unit that rejects the heat (a cooling tower, wet; or a dry cooler, dry, for a plant without water use) is shared: in cold weather its water cools the chilled water directly through a plate heat exchanger and the chiller is bypassed; in mild weather both run in series (the tower pre-cools, the chiller "trims"); in hot weather the chiller runs alone and the tower takes its condenser heat [Alfa Laval, waterside economisers; Armstrong, chiller plant with economiser]. With direct liquid cooling the facility water is warm (ASHRAE W32 to W45, up to 45 °C supply), so a dry cooler rejects it all year without a chiller. `app/scripts/make_sim_cases.py` builds one case of each from sim_1 on the same outdoor plant (a cooling tower), so only the inside differs, with the heat demand above; `dataset.json` → `plant` says how the plant is built, and the Structure page draws it. In both, `HVAC_Ener` is the plant's own electricity (the chiller, plus 2 % of the IT power for fans and pumps), no longer EnergyPlus's: the free cooling shows in it. Both come with the heat distribution's plant models picked (`site.json` → `heat_components`: the direct heat exchanger with an approach, the 0.5 MW heat pump, the storage tank), so Heat Matching runs all three parts on their Model from the start.

**A1, air-cooled (`sim_1_air`).** The CRAH on chilled water at 18/24 °C, a water-cooled chiller with a cooling tower and a free-cooling plate HEX:

$$
\begin{aligned}
T_{tw} &= T_{wb,t-1} + \Delta T_{tower}, \qquad s = \operatorname{clip}\!\left(\frac{T_{chwr} - \Delta T_{phe} - T_{tw}}{T_{chwr} - T_{chws}},\ 0,\ 1\right) \quad \texttt{FC\_Share} \\
\text{COP} &= \min\!\left(8,\ 0.5\,\frac{T_{chws}[K]}{T_{cond} - T_{chws}}\right), \qquad P_{HVAC} = \frac{(1-s)\, P_{IT,t-1}}{\text{COP}} + 0.02\, P_{IT,t-1} \\
Q_{cond} &= (1-s)\, P_{IT,t-1} \left(1 + \tfrac{1}{\text{COP}}\right) \quad \text{only what passes the chiller}
\end{aligned}
$$

with $\Delta T_{phe} = 2$ K and $T_{cond}$ the condenser water plus 2 K. Free cooling is full below a wet bulb of 12 °C and off above 18 °C; over sim_1's warm year it takes half of the load. The **hall** point is the air-cooled dataset's; the **condenser** point is as above, but only the chiller's heat passes it: in free-cooling hours it has none (the heat goes through the plate HEX to the tower, at about 20 °C).

**W1, water-cooled (`sim_1_water`).** The same plant outside, only the inside different. Cold plates take $f = 0.75$ of the IT heat on facility water, which the tower cools through a plate HEX all year (its water is always colder than 40 °C here); the rear doors take the rest on the plant's chilled water, free-cooled like A1's and trimmed by the chiller:

$$
\begin{aligned}
T_{FWS} &= \operatorname{clip}(T_{tw} + \Delta T_{phe},\ 40,\ 45)\ °\text{C}, \qquad Q_{liq} = f\, P_{IT,t-1}, \quad \dot m = \frac{\max(Q_{liq},\ 0.5\cdot 50)}{c_{p,w}\cdot 10\ \text{K}}, \quad T_{in} = T_{FWS} + \frac{Q_{liq}}{\dot m\, c_{p,w}} \\
P_{HVAC} &= \frac{(1-s)(1-f)\, P_{IT,t-1}}{\text{COP}} + 0.02\, P_{IT,t-1}, \qquad Q_{cond} = (1-s)(1-f)\, P_{IT,t-1}\left(1 + \tfrac{1}{\text{COP}}\right)
\end{aligned}
$$

and the recovered heat and the outlets as above: the facility water comes back from the racks at 40–55 °C (the **liquid** point), the **condenser** carries the rear doors' share while the chiller runs. Its plant uses less than half of A1's electricity (1.4 against 3.3 kW on average): the chiller only works for a quarter of the heat.

`equations.json` of each holds these formulas; the *phys* model learns the tower approach, the electricity per IT kW, the facility supply and its approach above the wet bulb back exactly. The outlet equations take the flow and heat terms as fixed numbers (the values the inlet and flow equations learn): alone they are not identifiable.

## A blank case (`sim_blank`)

`scripts/make_sim_blank.py` writes `sim_blank` from `sim_1_air`: a data center to draw from scratch. Its `dataset.json` has `"blank": true`, so its structure has no built-in drawing: it is the data center itself, a box to draw in that fills the drawing, with what goes in and out outside it (`boundary`, `DcBoundary`). Its inputs (the weather, the IT load) and outputs (`DC_INTERFACE`: the electricity, the heat rejected) sit in a thin band above it, an arrow from the border into the box each; the heat to recover is on its right edge, at the connection point, in one column in a narrower margin (`MARGIN_NARROW`) with the heat distribution right beside it. Like any variable they can be dragged (also into the box) once the drawing is unlocked; Save keeps where they are. The handle on the box's bottom edge makes the surface taller or shorter (drag it, or the arrow keys); its height is saved with the layout (`pid_layout` key `surface:`). Its data are A1's, under names that read as what they are: `IT_load` (the IT load in %), `T_outdoor` and `humidity` in; `IT_power`, `Cooling_power` (A1's plant electricity), the condenser water at the connection point (`Supply_temp`, `Return_temp`, `Water_flow`; `Heat_recovered` calculated) and `Heat_rejected` $=$ `IT_power` $+$ `Cooling_power` $-$ `Heat_recovered` out. Each has a note (`site.json` `pid_notes`), shown when it is clicked on the drawing. The graph file starts empty.

**Limits.** The chiller's COP is a Carnot share, the tower's fans and the pumps are a constant 2 % of the IT power; a dry cooler in place of the tower (no water use, warmer water: A2, or W1 without a chiller) and an outside-air economiser (A3) are not built.

## The cases in the new form (`sim_box_air`, `sim_box_water`)

`scripts/make_sim_box.py` copies `sim_1_air` and `sim_1_water` (data, graph, equations, models, site) as `sim_box_air` and `sim_box_water`, with `dataset.json` `"frame": true`: their structure is drawn as the blank case's, the data center a box with what goes in and out on its margins, and their own built-in drawing inside the box. The drawing loses its own heat-distribution box: its waste heat is piped to the box's right edge, into the heat distribution beside it, with the district's `Heat_Demand` under that. The row above the box holds the whole weather of the data (also the wind and the hour) and the inputs and outputs, under the example's own columns where it has them (`bindSetup` `renameFor`: `Out_Temp` is the outdoor temperature, `IT_Load` the IT load, `ITE_Ener` the IT electricity, `HVAC_Ener` the cooling electricity); a sensor tapped inside the drawing keeps its tap line down to where it is measured. A margin variable without data (`solar_radiation`, `Heat_rejected`) is marked *no data*, a variable to make. Dropping a column on a generic variable and choosing *= the same* binds them the same way for any data center (`dataset.json` `names`).


## A recovery case whose numbers match (`sim_recovery_air`)

In the cases above the recorded heat is a demand-limited share of what the plant makes, the condenser's heat comes in summer when the demand is small, and the cooling electricity does not see the recovery. *Recovery · air cooled* (`sim_recovery_air`, `app/examples/recovery_air_cooled/make.py`, in the new form) is one clean case, a 5 MW data center in Frankfurt with a seasonal district beside it, where all the electricity becomes heat and the recovery takes the hall's heat up to the district loop's capacity, as far as the loop's cold pipe lets it; what the district uses of it, hour by hour, is Heat Matching's. The script's docstring derives every equation and gives the literature range of every constant; its `README.md` says how to regenerate it.

**Weather and clock.** Real hourly weather of 2023 and 2024 at the European Central Bank, Frankfurt am Main: ERA5 reanalysis from the Open-Meteo historical weather API (CC BY 4.0), in `weather_frankfurt.csv.gz` (`Out_Temp`, `Out_Hum`, `Out_Wind`, `Out_Wind_Dir`, `Out_Solar`; UTC), on the hours of `sim_1` (two years of 364 days; `sim_district_heat` has the same hours). The time stamps are UTC; the people, the offices and the IT's day follow Frankfurt's clock, summer time too.

**Size and PUE.** IT 2,000 kW idle to 5,000 kW peak, a colocation-like load of ~72 % of the design (3,623 kW mean, a little higher in business hours, growing ~2.5 % a year), the server fans 0.6 % more per K of inlet air above 24 °C. The supply-air setpoint `Cool_Set` is held for one to four weeks, then changed. The plant is that of the 750 kW case this example started as, scaled by `SCALE` = 5000/750. **PUE 1.21** (ISO/IEC 30134-2, the whole facility: IT, cooling, electrical losses and the building): 1.20 in winter, 1.23 in summer. Of the IT power, cooling is 7.7 % (CRAH fans, chilled-water pumps, the chiller and the tower in summer, the electrical rooms' units), electrical losses 9.5 % (a 2N double-conversion UPS of the 2010s at ~36 % load, ~93.5 % efficient, and transformers, PDUs, busbars; today's UPS would give ~1.16) and the building 3.5 % (lighting, offices, security, generator heaters). `dataset.json` → `kpi` maps `Elec_Loss_Ener` and `Building_Ener` as `other_power`, so the Dashboard shows the full PUE.

**Plant.** Hall air (CRAH, hot-aisle containment) → chilled water (18 °C supply, ~30 °C return: the hot-aisle air minus a 6 K coil approach) → **recovery HEX** → free-cooling plate HEX → chiller (trim) → cooling tower. The recovery HEX (point `hall`, columns `HEX_Hall_*`, water: $c_p = 4.18$) sits on the chilled-water return, ahead of the free cooling and the chiller. It gives the hall's heat to the cold pipe of a low-temperature (5th generation) district loop, up to the loop's capacity $Q_{LOOP} = 4{,}333$ kW, as far as the pipe's temperature lets it. That pipe (`Loop_T_cold`, an input of the data center) runs through the ground and warms when it gets more heat than the buildings' heat pumps take out: 6–8 °C in winter, when the district takes everything (all the hall's heat recovered), ~20 °C in summer, when it needs ~0.65 MW of the data center's ~3.7: then the recovery HEX takes ~68 % of the hall's heat and the free cooling (on the water it leaves) and the chiller take the rest. The loop and the ground take the summer's surplus (no seasonal storage is modelled), so `HEX_Hall_Q` is the heat the data center gives the loop (ERF 0.73 on the Dashboard). Structure and Modelling draws it there: the air-cooled drawing puts the *Hall HEX* on the warm water from the CRAH, ahead of the chiller, instead of in the hot-aisle air, whenever the hall's $Q$ is computed with a water $c_p$ (`dataset.json` → `derived`, $c_p > 2$), and its variables are tapped on that pipe (`DC_TAPS_HALL_WATER`, `HALL_WATER`). Every hour, from the values of the hour before:

$$
\begin{aligned}
P_{IT} &= (2000 + 3000\, u_{t-1})\,\big(1 + 0.006\,\max(0,\ T_{i,t-1} - 24\ °\text{C})\big) \ \text{kW}, \qquad Q_{hall} = P_{IT} + P_{fan} \\
Q_{rec} &= \min\!\big(Q_{LOOP},\ Q_{hall},\ \varepsilon\, \dot m\, c_{p,w}\,(T_{in} - T_{loop,t-1})\big) = \dot m\, c_{p,w}\,(T_{in} - T_{out}), \qquad Q_{LOOP} = 4333\ \text{kW},\ \varepsilon = 0.8 \\
R &= Q_{hall} - Q_{rec}, \qquad W_{ch} = \frac{(1-s)\, R}{\text{COP}}, \qquad W_{tw} = 0.035\,(R + W_{ch}) \\
P_{HVAC} &= P_{fan} + P_{pump} + W_{ch} + W_{tw} + W_{el}, \qquad Q_{rej} = R + W_{ch} + W_{tw} + P_{pump} + P_{loss} + W_{el} + P_{bld} \\
&\Longrightarrow\quad P_{IT} + P_{HVAC} + P_{loss} + P_{bld} = Q_{rec} + Q_{rej}
\end{aligned}
$$

with $u$ the IT load (`IT_Load`), $T_i$ the hall's inlet air (`In_Temp`), $T_{loop}$ the loop's cold pipe (`Loop_T_cold`), $\varepsilon$ the plate's effectiveness, $s$ the free-cooled share (`FC_Share`: the free-cooling plate HEX cools the water the recovery leaves toward the tower water), $P_{fan}$ the CRAH fans (6 % of the design heat at full airflow, ~flow$^{2.3}$), $P_{pump}$ the chilled-water pumps (1.2 % of the design heat at design flow, ~flow$^2$), $P_{loss}$ = `Elec_Loss_Ener` (the 2N UPS and 2 % of the IT power in transformers, PDUs, busbars), $W_{el}$ the electrical rooms' units, $P_{bld}$ = `Building_Ener` (60 kW base, 30 kW lighting by day, heating below 15 °C, the offices' cooling above 22 °C) and `Heat_rejected` $= Q_{rej}$ (`HEX_Hall_Q` + `Heat_rejected` = every kW of electricity, exactly, every hour).

**Demand.** `Heat_Demand` is the district's heat demand beside the data center, an input that no column of the data center follows (replace it with a district's measured demand: `make(base, demand=...)`). It is the demand of the district generator (`app/examples/district_heat_demand/make.py`, below) with UA 520 kW/K on the 72 h mean outdoor temperature, a 2 K soft heating limit at 16 °C (German practice, VDI 4710 / VDI 3807), a day curve of thousands of dwellings (peak/mean ~1.28 on a winter day) and 400 kW of hot water (~10 % of the heat), on the data center's own weather and with its own noise: ~30,000 MWh a year, 203–14,713 kW, a town district of some 2,500–3,000 dwellings. It is the same kind of district as `sim_district_heat`, but not its series. In January it asks ~1.5 times the heat pump's ~4.8 MW, in summer ~0.65 MW. Lifted by the heat pump, the data center's heat covers about 75 % of it hour by hour in Heat Matching, the rest in winter.

| Year | IT | Cooling | Electrical losses | Building | Recovered (`HEX_Hall_Q`) | Rejected | Demand | PUE |
|---|---|---|---|---|---|---|---|---|
| 2023 | 31,201 MWh | 2,280 MWh | 2,670 MWh | 768 MWh | 27,991 MWh | 8,927 MWh | 29,861 MWh | 1.183 |
| 2024 | 32,097 MWh | 2,354 MWh | 2,712 MWh | 768 MWh | 29,134 MWh | 8,797 MWh | 30,223 MWh | 1.182 |

The heat it gives (recovered + rejected = all its electricity) is about 38,000 MWh a year, about 28,000 MWh of it recovered.

**Twin.** Every effect of the plant acts one hour later (lag 1). The plant's columns hang on `IT_Load` (the load of hour $t-1$ is the IT power of hour $t$; `ITE_Ener[t-1]` would be an hour late), on the hall (`In_Temp`), the weather and the loop's cold pipe; `Heat_Demand` has no children. The longer lags in `causal_graph.json` are those Causal discovery (TempCaFe: PCMCI, partial correlation, α 0.01, lags 1–6 h, *Refine the drawn graph*) found on 2023, the training year, kept once after a review (`LINKS` in `make.py`): with them the XGBoost twin follows the hall's humidity and the building better on the held-out year (free-run $R^2$ 0.976 and 0.979, from 0.917 and 0.946 with lag 1 only), the rest as good. Every plant variable is data-driven by default (Modelling's start for a data center); `HEX_Hall_Q` is calculated from its parts. For *phys*, `equations.json` (`EQUATIONS`) has an equation for every variable: the plant's data sheet as fixed numbers, the uncertain parts as learned coefficients. Six models are trained on 2023: *xgb*, *phys* and *linear* on the causal graph, and *linear_all*, *xgb_all* (all vs all, lags 1–5) and *sym* (symbolic regression on the graph) to compare them with; TabPFN is left out. Free run over the held-out 2024 ($R^2$):

| Variable | *xgb* | *phys* | *linear* | *linear_all* | *xgb_all* | *sym* |
|---|---|---|---|---|---|---|
| `ITE_Ener` | 0.998 | 1.000 | 0.997 | 0.997 | 0.998 | 0.997 |
| `In_Temp` | 0.993 | 0.996 | 0.996 | 0.996 | 0.953 | 0.996 |
| `In_Hum` | 0.976 | 0.953 | 0.947 | 0.946 | 0.916 | 0.947 |
| `HEX_Hall_T_in` | 0.993 | 0.996 | 0.996 | 0.996 | 0.942 | 0.996 |
| `HEX_Hall_T_out` | 0.990 | 1.000 | 0.803 | 0.885 | 0.993 | 0.768 |
| `HEX_Hall_m` | 0.992 | 0.997 | 0.977 | 0.976 | 0.975 | 0.972 |
| `FC_Share` | 0.956 | 1.000 | 0.649 | 0.666 | 0.610 | 0.620 |
| `HVAC_Ener` | 0.982 | 1.000 | 0.765 | 0.826 | 0.931 | 0.754 |
| `Elec_Loss_Ener` | 0.998 | 1.000 | 0.997 | 0.997 | 0.998 | 0.997 |
| `Building_Ener` | 0.979 | 0.881 | 0.711 | 0.819 | 0.983 | 0.709 |
| `Heat_rejected` | 0.997 | 1.000 | 0.831 | 0.891 | 0.993 | 0.820 |
| `HEX_Hall_Q` (calculated) | 0.991 | 1.000 | 0.801 | 0.898 | 0.989 | 0.760 |

The script stores this evaluation (lever `Cool_Set`, a 24-step window) as `models/evaluation.json`, so Modelling opens with these results ({doc}`evaluation`).

*phys* misses the hall's slow following of the outdoor moisture (`In_Hum`) and the offices' summer time (`Building_Ener`: the equation reads the UTC hour).

**District.** The script also builds the district's structure (`silver/district_structure`): the prepared variables `Out_Temp_mean24`, `Out_Temp_mean72` (*rolling_mean* of `Out_Temp`, 24 and 72 steps) and `Is_Weekend`, the graph `Heat_Demand` ← `Out_Temp`, its two means, `Is_Weekend` and `Hour` (lag 0: a demand follows the weather and the clock, not its own past, so its twin runs free over a year without drifting), a semi-physical equation (`DISTRICT_EQUATIONS`: the soft heating limit on the 72 h mean, the day curve as two harmonics of the hour, a weekend factor, hot water), and the same six models (all vs all on the structure's own variables only); free-run $R^2$ of `Heat_Demand` in 2024: *linear* 0.881, *phys* 0.983, *xgb* 0.993, *linear_all* 0.904, *xgb_all* 0.993, *sym* 0.878, with the evaluation stored too. Its `site.json` `twin_model` is `xgb`: Heat Matching runs it. The example *Case 1 · Recovery, trained models* runs *xgb* for both the data center and the district: over 2024 it covers 75.8 % of the demand (22,737 of 30,013 MWh delivered, 7,276 MWh unmet, 8,532 MWh surplus, 4,338 MWh heat-pump electricity, SPF 5.24, CO₂ saved 3,430 t against gas). The Site map's heat sinks are the residential buildings around the European Central Bank north of the Main, 150 of them within 420 m, from OpenStreetMap (`district_buildings.json`, © OpenStreetMap contributors, ODbL), each a heat sink with its share of the generated demand of 2024 by floor area (heating limit 16 °C, 10 % hot water, 70/40 °C); a Wärmeatlas building (`wah-…`) is never kept in the committed example. The streets and paths among them (`district_streets.json`, 750 OpenStreetMap ways, ODbL), copied as `streets.json`, are where the Site map plans the heat network ({doc}`heat-network`); the data center's Site-map temperature is the hall water's mean `HEX_Hall_T_in`, 30 °C.

**Limits.** The loop's capacity is one fixed number, 4,333 kW, and the loop and the ground take the summer's surplus (no seasonal storage is modelled). The server fans' share is a straight line in the inlet air above 24 °C. The COP is a Carnot share and the tower work is proportional to the heat it rejects. The heat distribution's heat pump is the 5 MW unit (`hp_5mw`, `site.json` `heat_components`): about 4.8 MW of heat from the data center's ~3.7 MW (COP ~4.3 to 70 °C). It lifts from the hall water (~30 °C, `site.json` `source.temp_c`), not from the loop's cold pipe: its COP is an upper bound.

## A separate district to match it with (`sim_district_heat`)

*District · heat demand* (`sim_district_heat`, `app/examples/district_heat_demand/make.py`, with a `README.md`) is a residential district's hourly heat demand over the same two years, a simulation of its own: the demand formula above with the generator's defaults (some 500–900 dwellings; UA 95 kW/K on the 24 h mean outdoor temperature, a sharp heating limit, hot water 110 kW mean, AR(1) noise of about 2 %) on its own outdoor temperature (sim_1's with the two years swapped, plus an AR(1) noise of about 1 K). It is sized to the 750 kW data center this example started as (before it was scaled to 5 MW): 5,354 MWh in 2023 (peak 4,990 kW) and 5,566 MWh in 2024 (peak 3,721 kW), a hot-water base of 110 kW from June to August. Its graph has `Heat_Demand` on `Out_Temp` and on itself (lag 1); *phys* fits degree hours with the buildings' inertia, $a\,D_{t-1} + (1-a)\,(b \max(0, c - T_{t-1}) + d)$, and finds $b = 102$ kW/K, $c = 18.3$ °C, $d = 106$ kW (free-run $R^2 = 0.85$ in 2024; *linear* 0.63; the day curve is not in the equation).

**Matching the two.** In Heat Matching on *Recovery · air cooled*, *What if…* → *Weather from* and *Heat demand from* put the district's outdoor temperature and demand in (see [Heat distribution](heat-distribution.md)): the district's demand becomes this one, and the data center's model runs on its weather. Since no data-center column depends on `Heat_Demand`, the district's demand changes only what the loop, the heat pump and the storage have to match, and its weather only the free cooling, the cooling electricity, the building and the rejected heat: the recovery follows the IT load, the hall and the loop's cold pipe (`Loop_T_cold`, an input of the data center), not the weather. `sim_district_heat` is the small district (5,354–5,566 MWh a year against about 30,000 MWh for this one's own demand), far smaller than the data center's heat; no coverage for this pairing has been measured since the data center was regenerated.
