# Models

The twin is not one big model. It is **one small model per modelled variable**, each predicting its variable one step ahead from the inputs the causal graph allows (see {doc}`causal-graph`). Five kinds of learner can fill those slots. They differ in how flexible they are, how much you can read from them, and how much memory and time they need.

| Kind | Idea | Readable? | Typical use |
|---|---|---|---|
| **Linear** | Least-squares weights on the parents | Yes: one coefficient per input | The default; the model Scenarios and Heat distribution use |
| **XGBoost** | Gradient-boosted decision trees | No | Nonlinear behaviour, thresholds |
| **Physics** | Your equation, coefficients fitted to the data (gray box) | Yes: your equation | Components whose physics is known (heat exchangers, cooling towers) |
| **Symbolic regression** | A formula searched by genetic programming, on top of a linear model | Yes: a short formula | Discover a nonlinear term you did not know |
| **TabPFN** | A pretrained transformer that predicts from examples (in-context learning) | No | Small data, strong nonlinearity, no tuning |

---

## Common setup

All kinds share the same preparation (`backend/core/twin/fit.py:fit`):

1. **Variables and parents.** Only numeric columns are used, and never a **calculated** column (`dataset.json` → `derived`, such as a heat exchanger's $Q = \dot m\, c_p\, (T_{in} - T_{out})$): it is no target, no input, no suggested driver and has no equation, whatever the variable list or the graph says. A predicted $Q$ is computed from the predicted parts instead (the simulate endpoint returns it on request). Each modelled variable gets its parents from the graph (or from its equation, for physics); a variable that is a driver or has no parents is not modelled. The lag sign is dropped: inside the twin $\tau = |\text{lag}|$.
2. **Order.** Variables are ordered so that same-step (lag-0) parents come first (`step_order`).
3. **Train / test split.** The first fraction $s$ of the rows (default $s = 0.5$, the *split*) is the training period, the rest the test period. The split is chronological, never shuffled: the test period is genuinely *later* than anything the model saw. At least 10 training rows (after the largest lag) and one test row are required.
4. **Design matrix.** For every row $t \ge L_{max}$ (the largest lag in the model), the inputs are the parents at their lags. A column of ones is prepended (the intercept):

$$
X_t = \left[\,1,\; x^{(1)}_{t-\tau_1},\; \dots,\; x^{(m)}_{t-\tau_m}\,\right], \qquad y_t
$$

5. **Missing data.** Rows where any input or the target is missing (NaN) are left out of fitting and scoring.
6. **Per-variable statistics.** After fitting, the model stores for each variable: the residual standard deviation on the training rows $\sigma$ (used for Monte-Carlo noise in scenarios), the scale $\overline{|y|}$ (used by nMAE), one-step $R^2$ on train and test, nMAE on test, and the min / max / mean of the variable over the training period (used to clamp simulations).

<details>
<summary><b>Source code:</b> <code>backend/core/twin/fit.py</code> (fit)</summary>

```{literalinclude} ../../app/backend/core/twin/fit.py
:language: python
:pyobject: fit
```

</details>

---

## Linear regression

The predicted value is a weighted sum of the inputs plus an intercept:

$$
\hat{y}_t = \beta_0 + \sum_{i=1}^{m} \beta_i\, x^{(i)}_{t-\tau_i}
$$

The weights minimise the squared error over the training rows (ordinary least squares, solved with `numpy.linalg.lstsq`):

$$
\hat{\boldsymbol\beta} = \arg\min_{\boldsymbol\beta} \sum_{t \in \text{train}} \left(y_t - X_t \boldsymbol\beta\right)^2
$$

Each saved input also carries the standard deviation of its parent over the training period, so $|\beta_i| \cdot \operatorname{std}(x^{(i)})$ ranks the inputs by their effect on the prediction, independent of units.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/learners.py</code> (fit_linear)</summary>

```{literalinclude} ../../app/backend/core/twin/learners.py
:language: python
:pyobject: fit_linear
```

</details>

---

## XGBoost

XGBoost fits an ensemble of $K$ regression trees, each one correcting the residual error of the trees before it (gradient boosting):

$$
\hat{y}_t = \sum_{k=1}^{K} \eta\, h_k(X_t)
$$

The hyperparameters are fixed, chosen for small, smooth models; they are not tuned per variable:

| Parameter | Value | Meaning |
|---|---|---|
| `num_boost_round` | 300 | Number of trees $K$ |
| `max_depth` | 4 | Depth of each tree |
| `eta` | 0.05 | Learning rate $\eta$ (shrinks each tree's contribution) |
| `subsample` | 0.8 | Share of training rows each tree sees |
| `colsample_bytree` | 0.8 | Share of inputs each tree sees |
| `objective` | `reg:squarederror` | Squared error |
| `nthread` | 1 | One thread (keeps memory and CPU predictable) |

Trees cannot extrapolate: outside the range of the training data the prediction stays flat at the value of the nearest leaf. This matters in scenarios that push a setpoint beyond anything the data center did in the training period.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/learners.py</code> (XGB_PARAMS, fit_xgboost)</summary>

```{literalinclude} ../../app/backend/core/twin/learners.py
:language: python
:start-at: XGB_PARAMS = {
:end-at: XGB_ROUNDS = 300
```

```{literalinclude} ../../app/backend/core/twin/learners.py
:language: python
:pyobject: fit_xgboost
```

</details>

---

## Physics equations (gray box)

A **physics** model lets you write the right-hand side of a variable's equation. The *structure* comes from you (white box), the *coefficients* from the data (black box) — hence gray box. For example, the heat a condenser-side heat exchanger recovers is a share $\eta$ of the IT power plus the chiller's work, one hour later:

$$
Q_{HEX,t} = \eta \left(P_{IT,t-1} + P_{HVAC,t-1}\right)
$$

which you write as

```text
eta * (ITE_Ener[t-1] + HVAC_Ener[t-1])
```

These are the equations of the `sim_1_modified` simulation (`app/data/sim_1_modified/equations.json`):

| Variable | Equation | Coefficients learned |
|---|---|---|
| `In_Temp` | `a*In_Temp[t-1] + b*(Cool_Set[t-1] - In_Temp[t-1]) + c*ITE_Ener[t-1] + d` | `a`, `b`, `c`, `d` |
| `HEX_Hall_T_in` | `In_Temp[t-1] + dT` | `dT` |
| `HEX_Hall_m` | `ITE_Ener[t-1] / (1.006*dT)` | `dT` |
| `HEX_Hall_T_out` | `T_in - DT_air` | `dT`, `eps` |
| `HEX_Cond_m` | `maximum(Q_cond, 45) / (4.18*dT)` | `dT` |
| `HEX_Cond_T_in` | `maximum(WB + approach, 27) + Q_cond / (4.18*m_w)` | `approach`, `dT` |
| `HEX_Cond_T_out` | `T_in_w - minimum(Q_cond, Heat_Demand[t-1]) / (4.18*m_w)` | `approach`, `dT` |

In the file the short names are written out: `T_in` is `(In_Temp[t-1] + dT)`, `m_air` is `(ITE_Ener[t-1] / (1.006*dT))`, `DT_air` (the air's temperature drop) is `minimum(eps*maximum(0, T_in - 25), Heat_Demand[t-1] / (1.006*m_air))`, `Q_cond` is `(ITE_Ener[t-1] + HVAC_Ener[t-1])`, `m_w` and `T_in_w` are the condenser's `m` and `T_in` equations, and `WB` is the Stull wet-bulb formula of `Out_Temp[t-1]` and `Out_Hum[t-1]` (with `arctan`). Every term is from the previous hour, so every input of the *phys* model has a lag of at least 1, like the graph. The heat $Q$ of each exchanger has no equation: it is a calculated column (see below), $Q = \dot m\, c_p\, (T_{in} - T_{out})$ with the specific heat of air (1.006 kJ/(kg·K)) or water (4.18 kJ/(kg·K)). The derivation is in {doc}`simulated-heat-recovery`.

### The equation language

| Element | Meaning |
|---|---|
| `Var[t-k]` | Data column `Var`, $k$ steps back. `Var[t]` is the same step. `Var` must be a column of the dataset. |
| any other name | A coefficient to learn (`eta`, `a`, `T_min`, …) |
| numbers | Constants |
| `+ - * / **`, unary `-` | Arithmetic |
| `exp log sqrt abs tanh sin cos arctan` | Elementwise functions |
| `minimum(a, b)`, `maximum(a, b)`, `Min`, `Max` | Limits (the capitalised names are how sympy writes them, with two or more arguments) |
| `clip(x, lo, hi)` | Clamp to a range |
| `pdiv(a, b)` | Protected division: $a/b$, but $1$ where $\lvert b\rvert \le 10^{-3}$ |

`Target[t] = …` is accepted; only the right-hand side is kept. A variable written without its time (`In_Temp` instead of `In_Temp[t-1]`), `t` or a function name used as a coefficient, and an equation that uses no data are rejected with a readable message. The equation **defines the variable's inputs**: whatever it references, at whatever lag, replaces the graph's parents for that variable. The API also refuses the target itself at the same step (`In_Temp[t]` on the right of `In_Temp`'s equation).

**Safety.** The expression is parsed into a Python syntax tree and compiled against a whitelist (numbers, the operators above, the listed functions, `Name[t-k]` references and coefficient names). Anything else — attribute access, imports, other calls, keywords — is rejected before anything runs. So is a function with the wrong number of arguments, a number too large for a float, and a lag above `EQUATION_MAX_LAG` (100,000 steps). It is evaluated with numpy only.

<details>
<summary><b>Source code:</b> <code>backend/core/physics.py</code> (FUNCS, Equation)</summary>

```{literalinclude} ../../app/backend/core/physics.py
:language: python
:start-at: "FUNCS: dict[str, Callable] = {"
:end-before: "Ref = tuple[str, int]"
```

```{literalinclude} ../../app/backend/core/physics.py
:language: python
:pyobject: Equation
```

</details>

### Fitting the coefficients

The coefficients $\boldsymbol\theta$ minimise the squared residuals over the training rows, with `scipy.optimize.least_squares`:

$$
\hat{\boldsymbol\theta} = \arg\min_{\boldsymbol\theta} \sum_{t \in \text{train}} \left(g(X_t; \boldsymbol\theta) - y_t\right)^2
$$

All coefficients start at $1$. The Levenberg–Marquardt method is used when there are more training rows than coefficients, otherwise the trust-region method. A residual that is not finite (e.g. `log` of a negative number) counts as $10^6$, which pushes the search away from such regions. Because the start is $1$, an equation whose coefficients are far from 1 or of a different sign may need a better formulation (e.g. write `T_min` as an offset that is naturally of order one).

Variables **without** an equation in a physics model are fitted as linear regressions on their graph parents, so a physics model can mix both.

<details>
<summary><b>Source code:</b> <code>backend/core/physics.py</code> (fit_equation)</summary>

```{literalinclude} ../../app/backend/core/physics.py
:language: python
:pyobject: fit_equation
```

</details>

---

## Symbolic regression

Symbolic regression searches for a *formula*. Plain genetic programming (gplearn) is good at finding structure but poor at precise coefficients, and on dynamic variables it tends to settle on $y_t = y_{t-1}$ or on formulas that drift in a free run. The app therefore splits the job:

1. **Linear base.** A least-squares linear model on the parents gives exact coefficients for everything linear: $\ell(X_t) = \beta_0 + \sum_i \beta_i x^{(i)}_{t-\tau_i}$.
2. **Nonlinear rest.** gplearn evolves a short program $g$ for what the linear part leaves over, $r_t = y_t - \ell(X_t)$. The rest is standardised first, $\tilde r_t = (r_t - \mu)/s$, so the length penalty means the same for every variable. gplearn sees at most 3000 training rows (every $k$-th).
3. **Merge and simplify.** The final equation is

$$
\hat{y}_t = \ell(X_t) + \mu + s \cdot g(X_t)
$$

expanded and simplified with sympy, numbers rounded to 4 significant digits, and written in the physics-equation language. When no nonlinear term is worth its length, $g$ is a constant and the result is the linear model.

From then on the formula **is a physics equation**: it is simulated, evaluated and displayed exactly like one you wrote (it contains only numbers, so there are no coefficients left to fit). Example from an earlier `sim_1_modified` (`models/sym.json`, before the HEX columns were rebuilt), where a limit term was found for the condenser water temperature:

```text
HEX_Cond_T = 0.7584*Out_Temp[t-1] - 0.03339*Out_Temp[t-2] - 0.04798*Out_Temp[t-3]
           + 0.0961*Out_Temp[t-4] + 2.124*Max(-0.074, -0.528*Out_Temp[t-2]) + 9.547
```

| gplearn parameter | Value | Why |
|---|---|---|
| `function_set` | add, sub, mul, max, min | Readable formulas; max/min express limits. No division (it invites near-singular hacks). |
| `population_size` | 1000 | |
| `generations` | 15 | |
| `parsimony_coefficient` | 0.01 | Penalty on program length (on the standardised rest) |
| `random_state` | 0 | Repeatable |

<details>
<summary><b>Source code:</b> <code>backend/core/symbolic.py</code> (GP_PARAMS, fit_symbolic)</summary>

```{literalinclude} ../../app/backend/core/symbolic.py
:language: python
:start-at: GP_PARAMS = dict(
:end-before: def _parse
```

```{literalinclude} ../../app/backend/core/symbolic.py
:language: python
:pyobject: fit_symbolic
```

</details>

---

## TabPFN

TabPFN (v2 weights) is a transformer pretrained on a large number of synthetic regression problems. It does not train on your data in the usual sense: it is given a set of example rows $(X, y)$ as **context**, and predicts new rows by attending to those examples (*in-context learning*). No hyperparameters are tuned.

Its memory grows with the number of context rows times the number of inputs, so the app keeps both small:

| Limit | Value | Effect |
|---|---|---|
| Context rows | 1000, evenly spaced over the training period | The examples TabPFN predicts from |
| Inputs per variable | at most 30 | A variable with more parents is refused *before* any fitting (use the causal graph, not all vs all) |
| Prediction chunk | 1000 rows per call | Attention memory per call stays bounded |
| Estimators | 1 | Speed (about 14 ms per prediction on CPU) |
| Free run | first 720 steps of the test period | See {doc}`evaluation` |

It runs on the CPU with one torch thread (with XGBoost's OpenMP already loaded, torch's thread pool can deadlock on macOS). What is saved is not a network but the **context rows** (`models/<name>.boosters/<var>.npz`, arrays `X` and `y`); the regressor is rebuilt from them when the model is loaded.

<details>
<summary><b>Source code:</b> <code>backend/core/twin/learners.py</code> (fit_tabpfn, tabpfn_regressor)</summary>

```{literalinclude} ../../app/backend/core/twin/learners.py
:language: python
:pyobject: fit_tabpfn
```

```{literalinclude} ../../app/backend/core/twin/learners.py
:language: python
:pyobject: tabpfn_regressor
```

</details>

---

## Structure: causal graph or all vs all

Every kind can be trained on the causal graph's parents (`structure: "graph"`) or on all variables at lags $1..L$ (`structure: "all"`, see {doc}`causal-graph`). The app saves each combination under a fixed name; these names are a contract (file names on disk, simulate URLs) and are never renamed:

| Name | Kind | Structure |
|---|---|---|
| `linear` | linear | causal graph — **the model Scenarios and Heat distribution use** |
| `linear_all` | linear | all vs all |
| `xgb` | xgboost | causal graph |
| `xgb_all` | xgboost | all vs all |
| `phys` | physics | causal graph (no all-vs-all version) |
| `sym` | symbolic | causal graph |
| `tabpfn` | tabpfn | causal graph (no all-vs-all version: memory) |

---

## What is saved

`POST /api/datasets/{id}/models/train` fits the model and writes `models/<name>.json`, replacing a model of the same name. The name is checked (letters, digits, `_`, `-`, at most 64) *before* the fit, which can take minutes.

| Key | Meaning |
|---|---|
| `order` | Modelled variables in evaluation order |
| `variables.<v>` | Per variable: `intercept`, `inputs` (`parent`, `lag` (negative), `coef`, `std`), for equations also `equation` and `params`; `sigma`, `scale`, `nmae_test`, `r2_train`, `r2_test`, `min`, `max`, `mean` |
| `drivers` | Variables taken from the data |
| `max_lag`, `split_index`, `split_time`, `rows` | Largest lag, first test row, its time, number of rows |
| `kind` | `linear`, `xgboost`, `physics`, `symbolic` or `tabpfn` |
| `name`, `file`, `graph_file`, `requested_drivers`, `structure`, `max_lag_setting`, `variables_used`, `model_type`, `equations` | The training settings, so the page can retrain with the same ones |

XGBoost and TabPFN keep their learned part next to it, in `models/<name>.boosters/`: one booster per variable (`<var>.json`, XGBoost's own format) or the TabPFN context rows (`<var>.npz`). The folder is cleared before a retrain, so boosters of variables the new model no longer has do not linger. Coefficient-free kinds store `coef: 0` for every input.

<details>
<summary><b>Source code:</b> <code>backend/schemas.py</code> (TrainRequest), <code>backend/routers/training.py</code> (train)</summary>

```{literalinclude} ../../app/backend/schemas.py
:language: python
:pyobject: TrainRequest
```

```{literalinclude} ../../app/backend/routers/training.py
:language: python
:pyobject: train
```

</details>
