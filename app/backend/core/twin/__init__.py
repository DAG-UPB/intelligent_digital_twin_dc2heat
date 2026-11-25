"""The digital twin: one model per variable, inputs from the causal graph, run on its own predictions.

- graph.py     drivers, all-vs-all inputs, order inside a time step, lag convention
- learners.py  linear / XGBoost / TabPFN for one variable
- fit.py       fit every variable (physics and symbolic models are equations)
- estimate.py  how long a fit would take, from the same plan
- simulate.py  roll forward with interventions and noise; the free run over the test period
- evaluate.py  free-run scores and setpoint-change windows
"""

from .estimate import estimate
from .evaluate import evaluate, nmae, r2, setpoint_changes
from .fit import fit
from .graph import all_vs_all, default_drivers, input_name, step_order
from .learners import NotInstalled, predict, tabpfn_regressor
from .simulate import free_run, simulate

__all__ = [
    "NotInstalled",
    "estimate",
    "all_vs_all",
    "default_drivers",
    "evaluate",
    "fit",
    "free_run",
    "input_name",
    "nmae",
    "predict",
    "r2",
    "setpoint_changes",
    "simulate",
    "step_order",
    "tabpfn_regressor",
]
