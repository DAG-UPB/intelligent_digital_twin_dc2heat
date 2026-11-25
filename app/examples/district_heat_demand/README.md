# District · heat demand

A simulated residential district's hourly heat demand over two years (2023-01-01 to 2024-12-29), on an outdoor
temperature of its own. `make.py` writes it to `app/data/sim_district_heat/` (data, `dataset.json` with
`kpi.heat_demand: Heat_Demand`, `causal_graph.json`, `equations.json`, and the trained models `phys` and `linear`).

It is a separate simulation from the data center *Recovery · air cooled* (`sim_recovery_air`), sized to take about
what that one gives (~5,000 MWh a year): 5,354 MWh in 2023 (peak 4,990 kW) and 5,566 MWh in 2024 (peak 3,721 kW).

**Demand, every hour:** space heating `UA · max(0, 18.3 °C − T24)` on the residential day curve (night setback,
morning and evening peaks, a weekend factor), plus hot water (110 kW mean, its own day curve) all year, times an
AR(1) noise of about 2 %. `T24` is the mean outdoor temperature of the 24 h before. UA 95 kW/K is some 500-900
dwellings. **Weather:** data/sim_1's outdoor temperature (EnergyPlus) with its two years swapped, plus an AR(1) noise
of about 1 K: plausible for the same site, but not the weather the data center saw. The script's docstring gives the
sources of the constants. `heat_demand()` is also what `recovery_air_cooled/make.py` uses for the data center's own
demand (on its own weather, with its own noise).

**Match it** in Heat Matching on *Recovery · air cooled*: *What if…* → *Weather from* and *Heat demand
from* → *District · heat demand*. The district's demand replaces the page's, and both series go into the data
center's trained model as its drivers (pick *XGB · Causal graph* under the Data center card's *More options*).

**Regenerate** (from `app/`; about 2 s, 0.2 GB):

```bash
bash scripts/guard.sh .venv/bin/python examples/district_heat_demand/make.py            # data + models
bash scripts/guard.sh .venv/bin/python examples/district_heat_demand/make.py --no-train # data only
```

Then `POST /api/datasets/refresh` on the running app. The test is `tests/test_example_district_heat.py`.
