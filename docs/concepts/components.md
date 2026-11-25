# Components

The Components page is gone: the heat distribution is modelled under its *Structure and Modelling* like the data center. The component presets below remain, run by *Heat distribution* in place of a part's formula, and the API keeps check, run, fit and saving.

A component models one part of the plant (a heat exchanger, a heat pump, a thermal storage tank, or the whole data center as one unit) as a **small causal graph**. The data center's twin ({doc}`models`) uses the same logic: variables, each from its causes, at lags. A component can be pure physics (equations with known numbers), data-driven (the same equations with parameters learned from your measurements), or both. *Heat distribution* ({doc}`heat-distribution`) can run a component instead of a part's built-in formula.

---

## What a component is

A component is one JSON document (`Component` in `backend/schemas.py`):

| Field | What |
|---|---|
| `inputs` | Exogenous variables, each with a `unit` and a `default` (the value used when a run or a fit does not give it) |
| `nodes` | Internal variables and outputs, **one equation each**, with a `unit` and an `init` (the value before the first step, read by `[t-k]` references) |
| `outputs` | The nodes other parts read and the test run charts |
| `params` | Named numbers, each `fixed` or learned by the fit, with a `unit` and a `note` |
| `kind` | `heat_exchanger`, `heat_pump`, `storage`, `data_center` or `custom`: which part of Heat distribution can use it |
| `notes`, `source` | What it models, and where its equations and numbers come from |

### The equation language

A node's equation is the right-hand side in the physics language of Modelling ({doc}`models`, `backend/core/physics.py`), parsed against a whitelist with `ast`:

- `Name[t]` is an input, or another node at the **same** step; `Name[t-k]` is its value `k` steps back.
- Any other name is a **parameter**. A name that is not a parameter yet is added as one (value 1, to learn) when you leave the field.
- A number stays fixed. Functions: `exp log sqrt abs tanh sin cos arctan minimum maximum clip pdiv`.

### Its causal graph

The graph is read off the equations: every reference `Name[t-k]` is a link *Name → node* at lag *k*. The left column of the page draws it (inputs green, outputs orange; a node's own past is left out, as on the other mini maps).

Same-step links must not form a loop. The nodes are evaluated in a topological order of their same-step links (`graphlib`). An **algebraic loop** (`A[t]` reads `B[t]` and `B[t]` reads `A[t]`) is refused with the loop named; feedback goes through `[t-1]`, as in the storage tank's energy balance `E[t] = E[t-1] + …`.

<details>
<summary><b>Source code:</b> <code>backend/core/components.py</code> (check)</summary>

```{literalinclude} ../../app/backend/core/components.py
:language: python
:pyobject: check
```

</details>

---

## Running a component

`simulate` runs a component over input series: an input given as a list sets the number of steps, a number is held, a missing input takes its default. When no node reads itself or a later node at a lag, every node is one array operation; otherwise it runs step by step (a lag before the first step reads the node's `init`, or an input's first value). `outputs` limits the run to the nodes those need.

*Test run* on the page sets each input **constant**, as a **step** at half time or as a **ramp**, over a number of steps, and charts the outputs (one chart per unit).

<details>
<summary><b>Source code:</b> <code>backend/core/components.py</code> (simulate)</summary>

```{literalinclude} ../../app/backend/core/components.py
:language: python
:pyobject: simulate
```

</details>

---

## Fitting to your data

*Fit to my data* takes a CSV (header row, one row per step, comma or semicolon separated). You map its columns to the inputs and to the **nodes you measured**; unmapped inputs hold their default.

Each measured node is predicted **one step at a time** from the measured inputs and nodes (teacher forcing, as the one-step score of Modelling). A node that is not measured but feeds a measured one is computed from its equation. The residuals of all measured nodes, each divided by its standard deviation, are minimised together by least squares (`scipy.optimize.least_squares`), starting from the current values. Only parameters marked **learn** change, and only those a measured node depends on.

The result shows the fitted values and, per measured node, R² and nMAE (mean absolute error ÷ mean absolute value). With nothing to learn the fit only scores the equations against the data. *Use the fitted values* puts them into the editor (6 significant digits); *Save* keeps them.

A feedback through an unmeasured node (`x[t] = a·x[t-1] + …` with `x` not in the CSV) cannot be predicted one step at a time: the fit asks you to map that node.

<details>
<summary><b>Source code:</b> <code>backend/core/components.py</code> (fit)</summary>

```{literalinclude} ../../app/backend/core/components.py
:language: python
:pyobject: fit
```

</details>

**Privacy.** The CSV goes only to the app's own backend, is read in memory and is not stored. Saved components are `app/data/_components/<id>.json`, git-ignored like all of `app/data` except `sim_*`: a fitted component carries numbers learned from your data.

---

## The library

The presets are code (`backend/core/component_library.py`), read-only. *Import* copies one into your components (`my_<id>`), where you can edit, fit and save it.

| Preset | Kind | Model |
|---|---|---|
| Direct heat exchanger (approach) | heat exchanger | `T_cold_out = T_hot_in − approach`, `Q = eff · Q_hot`: the built-in direct HEX of Heat distribution as a component |
| Plate heat exchanger (ε-NTU, counterflow) | heat exchanger | ε = (1 − e^(−NTU(1−Cr))) / (1 − Cr·e^(−NTU(1−Cr))), Q = ε·C_min·(T_hot_in − T_cold_in), at most the offered heat; the hot flow from the offered heat and its ΔT, the network flow `m_cold`; Cr capped at 0.999 (Incropera, *Fundamentals of Heat and Mass Transfer*, ch. 11) |
| Thermal storage tank (water) | storage | `E_max = V·ρ·cp·(T_supply − T_return)/3600` kWh, standing loss `UA_loss·(T_mean − T_amb)`, `E[t] = clip(E[t−1] + (Q_in − Q_out − P_loss)·Δt, 0, E_max)`, `SOC = E/E_max` |
| Heat pumps 0.5 – 90 MW | heat pump | Carnot model, below |
| Data center as one unit | data center | IT load and outdoor temperature → cooling power (a PUE rising above a free-cooling limit), the heat to recover and its temperature (as the physics condenser source of Heat distribution) |

### District-heating heat pumps (Carnot model)

$$
\mathrm{COP}_t = \operatorname{clip}\!\left(\eta_C \cdot \frac{T_{supply,t} + 273.15}{\max(T_{supply,t} - T_{source,t},\ \Delta T_{lift,min})},\ 1,\ \mathrm{COP_{max}}\right)
$$

$Q_{max}$ is the thermal capacity up to the maximum supply temperature and the maximum lift (a data sheet's operating point often sits on them), going to 0 within 1 K above (the equation language has no *if*: `clip(limit + 1 − x, 0, 1)` is that 1 K ramp). `hp_2mw`'s default supply is 70 °C, under its 72 °C limit; the others' is 75 °C. Then the set point $Q_{set} = Q_{max}\cdot$ load, which the output follows with a first-order lag (compressor start, the condenser water warming up; time constant `tau_h`, 0.5 h, step `dt_h`): $Q_{heat,t} = Q_{heat,t-1} + (Q_{set,t} - Q_{heat,t-1})(1 - e^{-\Delta t/\tau})$, from 0 at the start; $P_{el} = Q_{heat}/\mathrm{COP}$ and $Q_{source} = Q_{heat} - P_{el}$. Heat Matching reads `COP` and `Q_max` and applies the same lag itself (its *Heat pump time constant*). The temperatures are the fluid temperatures: source inlet and supply outlet, as the built-in formula of Heat distribution. With the same $\eta_C$ and limits the preset gives the built-in numbers.

$\eta_C$ (learnable) of each size is the published COP divided by the Carnot COP $T_{sink}/(T_{sink} - T_{source})$ at the published operating point:

| Preset | Capacity | η_C | Max supply | Max lift | Basis (operating point → η_C) | Source |
|---|---|---|---|---|---|---|
| `hp_0_5mw` NH3, two-stage piston | 460 kW | 0.56 | 90 °C | 75 K | Sabroe DualPAC: COP 4.8 at 30/20 → 50/70 °C, COP_C 8.58 → 0.56 (15/5 → 70/90 °C: 0.64) | Johnson Controls Sabroe DualPAC data sheet |
| `hp_2mw` NH3, screw | 1.69 MW | 0.59 | 72 °C | 55 K | Sabroe HicaHP 193 S: COP 3.9 at 20/12 → 50/72 °C, COP_C 6.64 → 0.59 | Sabroe HeatPAC / HicaHP catalogue |
| `hp_5mw` R134a, turbo | 5 MW | 0.60 | 88 °C | 75 K | Friotherm Unitop 34FY, Zürich Walche: COP 3.08, river 3.5 °C → 50/70 °C, COP_C 5.16 → 0.60 | Wojtan (2012), Friotherm |
| `hp_14mw` NH3, screw, Drammen | 14 MW | 0.68 | 90 °C | 85 K | Star Neatpump, Drammen: COP 3.0, fjord 8 °C → 65/90 °C, COP_C 4.43 → 0.68 | Drammen Heat Pump |
| `hp_20mw` NH3, screw | 19.3 MW | 0.52 | 95 °C | 65 K | Sabroe HicaHP 407 L: COP 3.5 at 40/30 → 65/95 °C, COP_C 6.69 → 0.52 | Sabroe HeatPAC / HicaHP catalogue |
| `hp_90mw` R134a, turbo, Katri Vala | 90.6 MW | 0.56 | 88 °C | 85 K | Katri Vala, Helsinki, 5 × Unitop 50FY: COP 3.0, 20/4 → 45/88 °C, COP_C 5.31 → 0.56 | Wojtan (2012), Friotherm |

Across these units $\eta_C \approx 0.52$–$0.68$. David et al. (2017) surveyed 149 large heat pumps (1580 MW) in European district heating and report a practical COP of 3–4; Stockholm (seawater 3 °C → 80 °C at COP ≈ 3) gives $\eta_C \approx 0.65$. The Danish Energy Agency's technology data use a Lorenz efficiency of 40–63 % by size and source, which is higher in Carnot terms.

Caveats: Sabroe COPs are shaft COPs (the electric COP is about 3–5 % lower). The maximum lifts are the largest published operating points, not manufacturer limits. Minimum part load is not modelled (`load` is a plain 0–1 input).

**Sources.**

- A. David, B. V. Mathiesen, H. Averfalk, S. Werner, H. Lund (2017): *Heat Roadmap Europe: Large-Scale Electric Heat Pumps in District Heating Systems*. Energies 10(4), 578. <https://doi.org/10.3390/en10040578>
- Johnson Controls: Sabroe DualPAC data sheet, and Sabroe HeatPAC / HicaHP catalogue.
- L. Wojtan (2012): Friotherm large heat pumps (Zürich Walche, Sandvika, Rolfsbukta, Katri Vala). <https://unige.ch/sysener/download_file/view/1/310>
- Drammen Heat Pump. <https://en.wikipedia.org/wiki/Drammen_Heat_Pump>
- Danish Energy Agency: *Technology Data for Generation of Electricity and District Heating*, chapter 40 (heat pumps). <https://ens.dk/media/6571/download>

---

## How Heat distribution uses a component

Under *Calculation*, each of the heat exchanger, heat pump and thermal storage has a **Model** select: *Built-in formula* (the default; the numbers are those of {doc}`heat-distribution`) or a component of that kind. The choice is saved in `site.json` → `heat_components` (`{hex, hp, tank}` → component id; a missing key or an older `site.json` means the built-in formula). A component that has since been deleted falls back to the built-in formula, with a note.

The page runs the chosen component over the evaluated period (`POST /api/components/simulate`) and hands two of its nodes to the matching per step (`PartSeries` in `lib/matching.ts`):

| Part | Inputs given | Nodes read | Replaces |
|---|---|---|---|
| Heat pump | `T_source` = source temperature, `T_supply` = network supply | `COP`, `Q_max` (kW) | The Carnot COP and the fixed capacity |
| Heat exchanger | `T_hot_in` = source temperature, `Q_hot` = source heat (kW), `T_cold_in` = network return | `Q` (kW), `T_cold_out` (°C) | The heat passed (at most the source's) and the direct condition: direct if `T_cold_out ≥ T_supply` |
| Thermal storage | `T_supply`, `T_return` of the network | `E_max` (kWh), `loss_pct` (%/h) | The capacity and the standing loss; the tank's level is still balanced by the matching |

A part lists only components of its kind that have the two nodes it reads; inputs the component has beyond these take their defaults. The COP is held within 1.1–8, as the built-in formula. The flow diagram shows the window mean of the component's capacity.

<details>
<summary><b>Source code:</b> <code>web/src/pages/heat/partComponents.ts</code></summary>

```{literalinclude} ../../app/web/src/pages/heat/partComponents.ts
:language: typescript
:start-at: export const CONTRACT
:end-before: /** Which component replaces
```

</details>

---

## Limits

- At most 50 nodes, 20 000 steps per run, and a CSV of 20 MB / 100 000 rows (`backend/core/limits.py`).
- The fit scores one step at a time, not a free run of the component.
- In Heat distribution the storage tank's own energy balance (`E`) is not used: the matching decides charge and discharge. Only its capacity and loss come from the component.
- A run is one request per chosen part over the whole period; it reruns 250 ms after the period, the source heat (scale) or a choice changes.

---

## API

See {doc}`../architecture/api` (*Components*).
