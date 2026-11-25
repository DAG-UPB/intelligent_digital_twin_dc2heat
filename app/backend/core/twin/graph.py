"""Model structure from a causal graph: drivers, all-vs-all inputs, evaluation order.

Lag convention: graph files and saved models store lag = -tau (-1 = one step back, 0 = same
step); inside the twin, tau = |lag| >= 0 is the number of steps back.
"""

from graphlib import CycleError, TopologicalSorter

from ..dataset_files import Graph


def default_drivers(targets: Graph, columns: list[str]) -> list[str]:
    """Variables with no parents other than their own past: suggested as data-driven inputs."""
    return [c for c in columns if not any(p != c for p, _ in targets.get(c, []))]


def all_vs_all(columns: list[str], drivers: list[str], max_lag: int) -> Graph:
    """No causal graph: every predicted variable gets every variable at lags 1..max_lag."""
    return {v: [(p, -tau) for p in columns for tau in range(1, max_lag + 1)] for v in columns if v not in drivers}


def step_order(parents: dict[str, list[tuple[str, int]]]) -> list[str]:
    """Evaluation order inside one time step (parents as (name, tau)): lag-0 parents first."""
    ts = TopologicalSorter({v: [p for p, tau in ps if tau == 0 and p in parents] for v, ps in parents.items()})
    try:
        return list(ts.static_order())
    except CycleError as exc:
        raise ValueError(f"Same-step (lag 0) edges form a cycle: {exc.args[1]}") from exc


def input_name(parent: str, tau: int) -> str:
    """An input as the equation language writes it: p[t-k], or p[t] for the same step."""
    return f"{parent}[t-{tau}]" if tau else f"{parent}[t]"
