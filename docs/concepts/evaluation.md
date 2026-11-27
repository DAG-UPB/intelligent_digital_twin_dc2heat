# Evaluation

A twin is only useful for what-if questions if it behaves right **on its own**, over many steps, and **when a setpoint moves**. A model can predict the next hour very well from the true current state and still drift away within a day when it has to live on its own predictions. The app therefore scores every model in three ways, from the easiest to the hardest test.

| Score | Inputs the model sees | What it tells you | Where |
|---|---|---|---|
| **One-step** (`r2_test`, `nmae_test`) | The *real* past values of every input | How well each equation fits the data, one step ahead | Computed at training, saved in the model |
| **Free run** (`free_r2`, `free_nmae`, `free_mae`, `free_wape`, `free_mase`) | Real drivers; its *own predictions* for every modelled variable | Whether errors stay bounded over the whole test period | `POST .../models/evaluate` |
| **Setpoint changes** (`events[].nmae`, `events[].rmse`) | As the free run | Whether the twin reacts right after an operator moved a lever | `POST .../models/evaluate` |

All three use only the **test period** — the rows after the chronological split (see {doc}`models`).

---

## One-step and free run

In a **one-step** prediction every input is the measured value:

$$
\hat{y}_t = f_y\left(x^{(1)}_{t-\tau_1}, \dots, x^{(m)}_{t-\tau_m}\right), \qquad x \text{ measured}
$$

In a **free run** the twin starts at the split with the real history, and from then on every modelled variable is fed with the twin's own earlier predictions; only the drivers (weather, load, setpoints) come from the data:

$$
\hat{y}_t = f_y\left(\hat{x}^{(1)}_{t-\tau_1}, \dots, \hat{x}^{(m)}_{t-\tau_m}\right), \qquad \hat{x} = \begin{cases} x & \text{driver} \\ \text{own prediction} & \text{modelled} \end{cases}
$$

Errors compound in a free run, so it is the honest test of a dynamic model. It is the same computation as a scenario without interventions and without noise (`simulate` with one draw, see {doc}`scenarios-simulation`), including the clamp of each variable to its training range widened by one span on each side.

**TabPFN** predicts step by step at about 14 ms per prediction, so its free run covers only the first **720 steps** of the test period (30 days of hourly data). Its free-run scores and setpoint changes are computed on that window only.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/simulate.py</code> (free_run)</summary>

```{literalinclude} ../../app/backend/core/twin/simulate.py
:language: python
:pyobject: free_run
```

</details>

---

## The metrics

**Normalised mean absolute error (nMAE).** The mean absolute error divided by the mean absolute value of the variable over the training rows, so it reads as a fraction of the variable's typical size and can be compared across variables with different units:

$$
\text{nMAE} = \frac{\frac{1}{n}\sum_{t} \left|y_t - \hat{y}_t\right|}{\overline{|y|}_{\text{train}}}
$$

Lower is better; the page shows it in percent. It is undefined (null) when the scale is zero or no row has both values. Note that the scale is the mean *absolute value*, not the range: for a variable that hovers far from zero (a temperature in °C) the same absolute error gives a smaller nMAE than for one that swings around zero.

**Coefficient of determination ($R^2$).** The share of the variance of $y$ that the prediction explains:

$$
R^2 = 1 - \frac{\sum_t \left(y_t - \hat{y}_t\right)^2}{\sum_t \left(y_t - \bar{y}\right)^2}
$$

$R^2 = 1$ is perfect, $R^2 = 0$ is no better than predicting the mean of the period, and in a free run it is often negative (worse than the mean). It is null for fewer than two rows or a constant $y$. Both metrics use only rows where the actual and the predicted value are finite.

Setpoint-change windows also report the root-mean-square error, $\text{RMSE} = \sqrt{\frac{1}{n}\sum_t (y_t - \hat{y}_t)^2}$, in the variable's own unit.

The free run is also scored with three more metrics, each over the rows where both values are finite:

**Mean absolute error (MAE)**, in the variable's own unit (kW, °C, …), so it answers "how far off, typically":

$$
\text{MAE} = \frac{1}{n}\sum_t \left|y_t - \hat{y}_t\right|
$$

**Weighted absolute percentage error (WAPE)**, the absolute error as a share of the measured total. Unlike the mean of $|e_t / y_t|$ (MAPE) it does not blow up at rows where $y$ is near zero; it is null when $\sum_t |y_t| = 0$:

$$
\text{WAPE} = \frac{\sum_t \left|y_t - \hat{y}_t\right|}{\sum_t \left|y_t\right|}
$$

**Mean absolute scaled error (MASE)** (Hyndman and Koehler, 2006): the free run's MAE divided by the MAE of the **seasonal naive** forecast $\hat{y}_t = y_{t-m}$ on the *training* rows. The season $m$ is the number of steps in 24 h at the data's median time step (24 for hourly data, 96 for 15-minute data; 1 when a step is a day or longer), so the naive forecast repeats the value of one day earlier:

$$
\text{MASE} = \frac{\frac{1}{n}\sum_{t \in \text{test}} \left|y_t - \hat{y}_t\right|}{\frac{1}{N-m}\sum_{t=m+1}^{N} \left|y_t - y_{t-m}\right|_{\text{train}}}
$$

Below 1 the twin, running on its own, beats "the same as yesterday"; above 1 it does not. It is null when the naive forecast is perfect on the training rows (a denominator of 0) or the training period is not longer than one season.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/evaluate.py</code> (nmae, r2, mae, wape, season_steps, mase)</summary>

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: nmae
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: r2
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: mae
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: wape
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: season_steps
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: mase
```

</details>

### On the Modelling page

The Results table shows, per predicted variable, the best model of each structure with its one-step, free-run and after-setpoint nMAE, and then, under *Best · free run*, the overall best model's MAE (with the variable's unit when the dataset config names it: a heat point's q in kW, its temperatures in °C, its mass flow in kg/s, the KPI powers in `power_unit`), WAPE, $R^2$ and MASE. Hover a header for what it means. It sits on top of Modelling, under the bar with *Model…* (the modelling window, above the results when opened) and the results of the variable picked; a click on a row picks its variable. Beside it, in the column on the left, *Structural equations · best model per variable* lists the winner's equation of each variable in a small box that scrolls inside, the picked one marked and scrolled to.

**One variable's results.** A variable picked on the drawing, on the causal map, in the results table or in the columns gets a card above the results table, *Results · \<variable\>* (`web/src/pages/datacenter/modelling/VariableResults.tsx`): every saved model that predicts it, with its kind, MAE in the variable's unit, WAPE, $R^2$, MASE and nMAE of the free run, the best first and marked (ranked as the results table ranks, `ranking.ts` `candidatesOf`), each with *Inspect*. A variable without results says why instead: an input taken from the data, a calculated column (the heat exchanger's $Q$), no data, not modelled, a profile, no saved model, or not evaluated yet (with *Evaluate*). Under a column's settings (in the modelling window) the same scores are listed for each of its variables, with the best model of that approach only: the Data-driven column's under *Train the models*, the Physical column's (the physics model) under its equations; a column with no saved model of its approach lists nothing.

**Inspect** opens that model's fit of the variable up close (`web/src/pages/datacenter/modelling/FitDialog.tsx`); a select switches to any other trained model that predicts it. The dialog runs the same free run through `POST .../models/{name}/simulate` (from the split, to the end of the data, at most 20 000 steps; TabPFN its first 720 steps), which also returns the measured rows, and shows:

- the scores at the top: MAE, WAPE, $R^2$, MASE and nMAE of the free run, and the one-step nMAE and $R^2$;
- **predicted vs measured**: a scatter with the same range on both axes and the $y = x$ diagonal, the measured values' histogram on the top margin and the predicted values' on the right;
- **residuals vs predicted**: measured − predicted against the prediction, a zero line, and the residuals' histogram on the right margin (a trend or a funnel here is structure the model missed);
- the two series over time, to zoom into.

The scatters draw at most 3000 points, spread evenly over the period; the histograms count every row. A test period longer than 20 000 steps (the simulate route's limit, `SIMULATE_MAX_STEPS` in `backend/core/limits.py`) is plotted for its first 20 000 steps only; the scores at the top still cover all of it. Rows where either value is missing are left out.

---

## Setpoint-change windows

The reason to build a *causal* twin is to answer "what if we change this setpoint?". The closest the data gets to that question are the moments an operator actually changed one. The app finds those moments and scores the twin right after each.

1. **Levers.** The levers are the dataset's setpoint variables. Modelling sends `levers` from `dataset.json` (e.g. `Cool_Set`), or the `actuators` when no levers are listed; the API default is `["Cool_Set"]`. Only levers that are drivers of the model are used.
2. **Changes.** A step $i$ is a change when the lever moves by more than **2 % of its range** from one step to the next — larger than measurement noise:

$$
\left|u_i - u_{i-1}\right| > 0.02 \left(\max u - \min u\right)
$$

3. **At most 50 events per lever.** A lever that moves all the time (a modulating valve) would give thousands of events, so an evenly spaced subset of 50 is kept. The subset is taken over the *whole* column, before the events outside the test period are dropped, so fewer than 50 may remain.
4. **Window.** Each event is scored over the `horizon` steps after the change (default 168, one week of hourly data; at most 2000), cut short where the free run ends.
5. **Same free run.** The window is cut out of the *one* free run that started at the split — the twin is not restarted from the real state at the event. A model that has drifted before the event carries that error into the window. This is deliberate: it is how the twin would be used, running on its own.

For each event the response gives the lever, its value before and after, the predicted and the actual curves of every modelled variable, and their RMSE and nMAE. When several models are compared, events are merged by (lever, start) and the window is cut to the shortest of them.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/evaluate.py</code> (setpoint_changes, evaluate)</summary>

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: setpoint_changes
```

```{literalinclude} ../../app/backend/core/twin/evaluate.py
:language: python
:pyobject: evaluate
```

</details>

---

## Caching

A free run does not depend on the lever list or the horizon, and for TabPFN it takes minutes. The backend therefore keeps, in memory, one free run per model file, keyed by the file's modification time: changing the horizon or the levers on the page reuses it; retraining the model (a new file) recomputes it. Loaded XGBoost boosters and TabPFN regressors are cached the same way. The caches live in the server process and are lost when it restarts.

All models of one evaluate request are scored on the data file of the first model (models of one dataset share it today).

### The stored evaluation

The page asks to keep each evaluation (`store: true` in `POST .../models/evaluate`; off by default for every other caller). The answer is then written to `models/evaluation.json`, beside the models it scored, with what it scored: the model names, the levers, the window (`horizon`) and a SHA-256 of each model's file and boosters (their content, not their file times, which a git checkout changes; hidden files such as `.DS_Store` are skipped). `GET .../models/evaluation` returns it while every hash still matches, and `null` when nothing is stored or a model it scored has changed or gone. The page loads it when it opens and shows it at once (*The stored evaluation of the N saved models (unchanged since)*, with *Evaluate again*) if it scored exactly the saved models on today's levers; it then takes the stored window too. Otherwise it says *N saved models, not evaluated yet* with *Evaluate on the test period*, as before.

- **Not a model.** The file is left out of `GET .../models`, and a model named `evaluation` is refused (400).
- **Size.** Above 2 MB (`EVALUATION_STORED_MAX_BYTES` in `backend/core/limits.py`: long windows after many changes) the setpoint windows are dropped and only the scores kept.
- **The data is not checked.** A data file changed under unchanged models keeps its old scores until someone evaluates again.
- **Written in place.** Two evaluations stored at the same moment can overwrite each other; the last one written wins.
- **It holds measured values.** Each setpoint window keeps the measured curve beside the predicted one, so the file of a real data center is as confidential as its data ({doc}`../architecture/data-and-privacy`).

<details>
<summary><b>Source code:</b> <code>backend/routers/training.py</code> (stored_evaluation, _store) and <code>backend/core/model_store.py</code> (fingerprint)</summary>

```{literalinclude} ../../app/backend/routers/training.py
:language: python
:pyobject: stored_evaluation
```

```{literalinclude} ../../app/backend/core/model_store.py
:language: python
:pyobject: fingerprint
```

```{literalinclude} ../../app/backend/routers/training.py
:language: python
:pyobject: _store
```

</details>

<details>
<summary><b>Source code:</b> <code>backend/core/model_store.py</code> (caches, load)</summary>

```{literalinclude} ../../app/backend/core/model_store.py
:language: python
:start-at: "_boosters: dict[str, tuple[float, dict]] = {}"
:end-at: "_free_runs: dict[str, tuple[float, dict]] = {}"
```

```{literalinclude} ../../app/backend/core/model_store.py
:language: python
:pyobject: load
```

</details>

---

## Limits

The limits that keep evaluation and simulation within the app's 8 GB budget are named constants in one file:

<details>
<summary><b>Source code:</b> <code>backend/core/limits.py</code></summary>

```{literalinclude} ../../app/backend/core/limits.py
:language: python
```

</details>
