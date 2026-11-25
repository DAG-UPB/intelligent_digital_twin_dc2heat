# Dashboard

The **Dashboard** (*Data Center › Visualization and Scenarios*, `#/dc/dashboard`, in *Historical* mode) is where you look at a data center's data before you model it: how much data there is and over which period, what each variable looks like, how the variables move together, and the key figures of the data center that the columns support. It reads one data file of the chosen data center (the first, or the one picked in *Data file*) through `GET /api/datasets/{id}/summary`. Every number is computed in `backend/core/summary.py`, from the whole file.

| Part | What it shows |
|---|---|
| Data center KPIs | PUE, ERF, ERE, IT energy and heat reused, where the KPI variables are known, over the period the time series show |
| Overview cards | Rows, variables, time span, resolution, completeness, gaps |
| Explore · Time series | One small chart per chosen variable over the chosen period (a year, a month, or all the data), sharing time and the hover cursor, each with its period's distribution beside it |
| Explore · other views | *Daily profile* (one variable's mean day, with its 10 % and 90 % band), *Weekly and monthly* (side by side, about as wide: one variable's mean by weekday and hour, and every variable's monthly means), *Autocorrelation*, *Missing data* |
| Correlation | Pearson correlation matrix as a heatmap, and beside it the scatter of one pair, as big as the heatmap |
| Distributions | The histogram of every variable, from its minimum to its maximum; after the other charts |
| Variables | Descriptive statistics and role of every variable; sortable |

---

## How much data

Let the file have $N$ rows at times $t_1 \le \dots \le t_N$ and $V$ numeric variables (`time` excluded; ±∞ count as missing).

| Number | Definition |
|---|---|
| **Rows** | $N$ |
| **Variables** | $V$, the numeric columns |
| **Time span** | $t_N - t_1$, shown with the first and last timestamp |
| **Resolution** | The **median** step $\Delta t = \operatorname{median}_i (t_{i+1} - t_i)$, so a few missing rows do not change it (same rule as {doc}`heat-distribution`) |
| **Completeness** | The share of cells with a value: $\dfrac{\#\{(i, v) : x_{i,v} \text{ present}\}}{N \cdot V}$ |
| **Gaps** | The steps longer than $1.5\,\Delta t$: their count, and the longest one in hours |

A gap is a hole in the timestamps (rows that are not there), while completeness counts empty cells in rows that are there. Both matter for modelling: the twin learns from consecutive steps, and a lag across a gap links two moments further apart than it claims.

## Variables

For each variable, over its present values: count, missing (as a share of the rows), mean, standard deviation (sample, $n-1$), minimum, 25th percentile, median, 75th percentile and maximum (pandas `describe`, linear interpolation between ranks), and a histogram of 20 equal-width bins between minimum and maximum. The **role** comes from `dataset.json`: `heat` (orange), `lever` (a setpoint scored in evaluation), `actuator` (green) or `measured`. A column of `dataset.json` → `derived` is also marked **calculated** (`"calculated": true` in the summary): the heat $Q = \dot m\, c_p\, (T_{in} - T_{out})$ of a heat exchanger, kept in the table and the KPIs but never a model target (see {doc}`simulated-heat-recovery`). The table sorts by any column; empty values always go last.

## Time series

**Period.** The charts show one year to start with (the first in the data). In the panel on the left, under the causal graph (while the Time series view is open), the *Period* menu picks a year or both years and the *Month* menu one month of that year. The KPI cards at the top follow the period (their title says it): the KPI columns over the period's rows, by the same formulas as a Scenarios run (`kpisOf` for the data center, which counts only rows where every KPI column has a value; `partKpis` for the heat distribution and the district); for all the data they are the summary's. Scenarios keeps the whole file's.

**Variables.** The chips under the period: a click adds or removes a variable, a double click shows only that one (again on the lone one: all of them), *All* and *None* do what they say. A click on a variable in the causal graph adds or removes it the same way, a double click there shows only it. The shown columns are loaded in full (`GET /api/datasets/{id}/data`) and the period's rows are thinned to at most 1 500 points per chart, each the mean of consecutive rows: a year of hourly data becomes 6-hour means, a month stays every row. A data file of more than 200 000 rows is not loaded in full: its charts show the summary's bin means below, filtered to the period.

**Distribution beside each chart.** Left of each chart, the histogram of the period's rows turned sideways, binned over the chart's own y range (as it autoscales), so a level in the series meets its bar; values beyond the range are left out. On the summary's bin means (a very large file) it counts those means.

A year of 5-minute data is about 100 000 points per variable, more than a chart can show. The summary therefore cuts the rows into at most $B = 600$ runs of consecutive rows (row $i$ goes to bin $\lfloor i B / N \rfloor$), and each bin is drawn as the **mean** of its values at the timestamp of its **first** row. Means keep the level of the signal; a single spike shorter than a bin is smoothed out (the table's maximum still shows it). With fewer than 600 rows every row is a point.

The page draws **one chart per variable** (small multiples) instead of several lines on one chart: the variables have different units and scales, and two y-scales in one chart invite wrong comparisons. The charts share the time axis and the hover cursor. Lines, their distributions and the variable chips are coloured by how each variable is modelled, as on Structure and Modelling (`--way-*`): data-driven (blue, `--way-data`), physical (teal), profile (orange), or not modelled (grey: an input taken from the data and a calculated $Q$ too); the legend is under the chips.
## Correlation

The heatmap shows the **Pearson correlation** of every pair of variables,

$$
r_{xy} = \frac{\sum_i (x_i - \bar x)(y_i - \bar y)}{\sqrt{\sum_i (x_i - \bar x)^2}\,\sqrt{\sum_i (y_i - \bar y)^2}},
$$

computed over the rows where **both** have a value (pairwise complete), on the full data, not the downsampled series. $r = +1$: the two rise and fall together on a straight line; $r = -1$: one falls when the other rises; $r = 0$: no *linear* relation (there may still be a non-linear one, or one with a time lag, which is what the causal graph is for). A constant variable has no correlation ($0/0$): its cells are empty (`null`) and crossed.

The colour scale is diverging: blue for $-1$, a neutral grey for $0$, red for $+1$, mixed in proportion to $|r|$; it is the same in every palette, with its own light and dark steps. Hover a cell for $r$ with three decimals; up to 20 variables the cells are big enough to print the values in them. Above that the cells shrink to a 14 px minimum, the top labels turn vertical, and a matrix wider than the card scrolls sideways. Correlation is not causation: two variables driven by the same cause (the outdoor temperature, the hour of the day) correlate without one acting on the other.

**Order.** *Data order* keeps the columns as in the file. *Similar together* places strongly correlated variables next to each other, so that groups show up as blocks: it starts with the variable of largest total $\sum_{j} |r_{ij}|$ and then always moves to the nearest variable not yet placed, with the distance $1 - |r|$ (greedy nearest neighbour; a simple stand-in for hierarchical clustering).

**Scatter.** Clicking a cell (or picking *X* and *Y*) draws the two variables against each other, from the 600 bin means of the time series. Its $r$ label is the correlation of the full data.

## Data center KPIs

The Dashboard shows only the energy KPIs, centred in one row: PUE, ERF, ERE, the IT energy and the heat reused. They need to know which column is the IT power, the cooling power, the facility's other electricity (optional), the reused heat and the heat demand, and in which unit. That comes from an optional `kpi` mapping in the data center's `dataset.json` (see {doc}`../architecture/data-and-privacy`):

```json
"kpi": {"it_power": "ITE_Ener", "cooling_power": "HVAC_Ener", "heat_demand": "Heat_Demand",
        "reuse": {"hall": "HEX_Hall_Q", "condenser": "HEX_Cond_Q"}, "power_unit": "kW"}
```

This is `sim_1_modified`'s mapping. `reuse` names the reused-heat column of each heat-recovery option, and the one that `site.json` → `hex_option` selects counts (`condenser` by default, else the first). The options are alternative designs, so only one of them counts; the card notes say which HEX it is. Without `reuse` or `heat_power`, the `q` columns of `dataset.json` → `heat_source` are the options. Without the mapping the app uses only names it knows **exactly**: the simulations' `ITE_Ener` (IT), `HVAC_Ener` (cooling) and `Heat_Demand`, and with no `heat_source` every `HEX_*_Q` column, summed. A `heat_power` list in the mapping is summed too: several real recovery points add up. `other_power` (a column or a list, summed) is the facility's other electricity: UPS and distribution losses, lighting, the building. It comes only from the mapping, never from a column name, and each variable counts once: a repeat, or the IT, cooling or reused heat named again, is left out (`PUT .../kpi` refuses it). The Scenarios what-if of this page runs the twin on the IT, cooling and reused heat only (the other meters are rarely in the model), so its PUE is the partial one. The unit is kW for a `"kind": "simulation"` data center (the app's convention, see {doc}`heat-distribution`), or the mapping's `power_unit`. Without a power unit there is no energy card, because that would be a made-up number. The real data centers are not guessed from fuzzy names: a column called `line_A_watt` may or may not be IT power. They show a note asking for a `kpi` mapping instead. With IT power but no reused-heat column, ERF and ERE are left out and a note says why.

**Choose the KPI variables** under the KPI card writes that mapping without editing a file: pick the IT power (the servers' electricity), the cooling power (chillers, fans, pumps), the heat demand, the power unit, and tick the other facility power variables and the reused-heat variables (each summed). Save writes `dataset.json` `kpi` in the data center's silver folder (`PUT /api/datasets/{id}/kpi`), and the KPIs are computed from it at once; Clear removes it. It is unfolded when no KPI could be computed.

Let $E^{IT} = \sum_t \Delta t_t P^{IT}_t$, $E^{cool} = \sum_t \Delta t_t P^{cool}_t$ and $E^{reuse} = \sum_t \Delta t_t Q^{reuse}_t$, where $\Delta t_t$ is row $t$'s own step in hours: the shorter of its steps to the rows before and after it, so a file of mixed resolutions counts each part at its own step and a gap holds no energy. The ratios are taken over the rows where every column they use has a value. The total is $E^{DC} = E^{IT} + E^{cool}$, or $E^{DC} = E^{IT} + E^{cool} + E^{other}$ with $E^{other} = \sum_t \Delta t_t P^{other}_t$ when `other_power` is mapped (it counts only together with the cooling).

| KPI | Formula | Standard | Needs |
|---|---|---|---|
| PUE (partial), or PUE with `other_power` | $\mathrm{PUE} = E^{DC} / E^{IT}$ | ISO/IEC 30134-2:2016; EU Delegated Regulation 2024/1364, Annex III(a) | `it_power`, `cooling_power` (and `other_power` for the full one) |
| ERF, energy reuse factor | $\mathrm{ERF} = E^{reuse} / E^{DC}$ (0…1) | ISO/IEC 30134-6:2021; EU 2024/1364, Annex III(c) | the above and the reused heat |
| ERE, energy reuse effectiveness | $\mathrm{ERE} = (E^{DC} - E^{reuse}) / E^{IT} = (1 - \mathrm{ERF})\,\mathrm{PUE}$ | The Green Grid, White Paper #29 (2010) | the same |
| IT energy, total | $E^{IT}$; kW → MWh, W → kWh | | `it_power` and a power unit |
| Heat reused, total | $E^{reuse}$, with the selected HEX and the share of the demand covered, $\sum_t Q^{reuse}_t / \sum_t D_t$, in the note | | the reused heat and a power unit (`heat_demand` for the share) |

**Without `other_power` all three ratios are partial.** The total facility energy also includes lighting, UPS and distribution losses, but the data usually has only IT and cooling. The true PUE is then higher, and ERF and ERE are computed on the same partial total; the PUE card says *IT + cooling only*. With `other_power` (and the cooling) the total is the whole facility's: the card is called *PUE*, its note says *total facility ÷ IT · ISO/IEC 30134-2*, and the notes of ERF and ERE say *IT + cooling + other*. The Modelling's KPI variables card and the drawing's *KPI variables* show the same formulas with the bound names. ERF counts only heat that is actually used outside the data center (EU 2024/1364, Annex II 1(j)). This is why the simulation's recovered heat is limited by the demand (see {doc}`simulated-heat-recovery`). Recovering heat does not lower the PUE. ERE equals PUE when nothing is reused and drops below it, possibly below 1, when heat is reused.

Which KPIs appear today:

| Data centers | KPIs |
|---|---|
| Simulations 1–5 | PUE (partial), IT energy, and the note that there is no reused-heat column |
| Simulation 1 · with heat exchangers | PUE 1.10, ERF 0.33 and ERE 0.73 with the condenser HEX (ERF 0.25 and ERE 0.82 with the hall HEX), IT energy 669 MWh, heat reused 243 MWh with the condenser HEX (73 % of the demand covered; hall HEX 186 MWh, 56 %) |
| MiniDC, demonstrator, real data sets | The note: choose the KPI variables |

## Data files too big to load

A data center may be delivered as one big CSV (gigabytes, hundreds of columns) in bronze. The app lists it without loading it: its variables, its time span and its step come from the header, the first 1000 rows and the last line (`core/csv_data.py`), and the row count is estimated from the file size. A CSV above `CSV_LOAD_MAX_BYTES` (200 MB) is never loaded whole, so pages that need its values say so instead of running out of memory, and it is listed after the data files that can be loaded, so the pages open one of those by default. The Structure and Modelling page has all its variables either way. A German export (`;` separated, a decimal comma: `1.234,5`, dates as `31.01.2024 13:00`) is read as it is meant: its numbers with the comma, its dates day first. One date format is chosen for the whole file; a time that does not read in it is refused with the row's text, never dropped. Times with a UTC offset (`+02:00`), or a parquet's times with a time zone, are read as UTC, so a clock change neither repeats nor drops an hour. A time column of numbers is read as unix time (seconds, milliseconds, micro- or nanoseconds since 1970, told apart by their size), in a CSV and a parquet file alike; other numbers (a row number) are not taken as times. The same rules hold for the CSVs of *Import a folder*.

The Dashboard then shows **A very large data file**, with its variables (tick the ones to keep) and two ways to make a data file from it, both read a block of `CSV_CHUNK_ROWS` rows at a time and written to silver like an aggregated file:

- **Aggregate**: one row per step (15 minutes, 1 hour, 1 day: coarser than the data) over the whole period, each variable by the method (mean, median, sum, min, max, last value). Each block's finished steps are aggregated at once and the rows of its last step wait for the next block, so every step is computed over all its rows: the result is exactly that of aggregating the whole file, for every method. Measured on 2.4 GB of 280 columns at one-minute steps, to one hour: 15 s, 670 MB at most.
- **One period**: every row from a start up to an end (a day, a week), as delivered; reading stops past the end when the file is in time order. At most `CSV_WINDOW_MAX_CELLS` values.

<details>
<summary><b>Source code:</b> <code>backend/core/resample.py</code> (resample_chunks)</summary>

```{literalinclude} ../../app/backend/core/resample.py
:language: python
:pyobject: resample_chunks
```

</details>

## Performance

The summary is vectorised (pandas `describe`, `corr`, `groupby`; one `numpy.histogram` per variable) and takes a few hundredths of a second for 20 000 rows of 30 columns. It is cached per data file and recomputed only when the parquet file, `dataset.json` or `site.json` changes (their modification times). The response holds at most 600 points per variable.

<details>
<summary><b>Source code:</b> <code>backend/core/summary.py</code> (summarize, kpi_columns, kpis)</summary>

```{literalinclude} ../../app/backend/core/summary.py
:language: python
:pyobject: summarize
```

```{literalinclude} ../../app/backend/core/summary.py
:language: python
:pyobject: kpi_columns
```

```{literalinclude} ../../app/backend/core/summary.py
:language: python
:pyobject: kpis
```

</details>

<details>
<summary><b>Source code:</b> <code>web/src/pages/datacenter/dashboard/dashboard.ts</code> (colour scale, ordering)</summary>

```{literalinclude} ../../app/web/src/pages/datacenter/dashboard/dashboard.ts
:language: typescript
:start-at: export function corrFill
:end-before: /** The variables the time-series chart
```

</details>
