"""Lag discovery with tigramite (PCMCI or PC, partial-correlation tests) for a graph you drew.

The structure stays yours: only the drawn links and every variable's own past are tested
(link_assumptions), and the significant lags of each are returned. relag_graph applies that to a
whole graph file (used by the dataset scripts).
"""

from __future__ import annotations

from typing import Literal

import pandas as pd

Method = Literal["pcmci", "pc"]


def discover_lags(
    df: pd.DataFrame,
    links: list[tuple[str, str]],
    min_lag: int = 1,
    max_lag: int = 5,
    alpha: float = 0.01,
    data_fraction: float = 1.0,
    method: Method = "pcmci",
) -> dict:
    """For links you drew (parent -> target), find which lags min_lag..max_lag are significant.

    PCMCI or PC tests only these links plus every variable's own past (link_assumptions),
    so the structure stays yours and only the lags are learned from the data.
    Returns {"links": {(parent, target): {"lags": [...], "p": {lag: p}}}, "self": {var: [...]},
    "skipped": [links whose variables are not in the data], "strengths": [...]}. "strengths" holds one
    graph-file link_strengths entry ({source, target, lag (negative), value}) per significant lag, own-past
    lags included; value is the ParCorr statistic (partial correlation) of that link and lag.
    """
    from tigramite import data_processing as pp
    from tigramite.independence_tests.parcorr import ParCorr
    from tigramite.pcmci import PCMCI

    if not 1 <= min_lag <= max_lag:
        raise ValueError("lags must satisfy 1 <= from <= to")
    numeric = [c for c in df.columns if c != "time" and pd.api.types.is_numeric_dtype(df[c])]
    usable = [(a, b) for a, b in links if a in numeric and b in numeric and a != b]
    skipped = [(a, b) for a, b in links if (a, b) not in usable and a != b]
    names = sorted({v for link in usable for v in link})
    if len(names) < 2:
        return {"links": {}, "self": {}, "skipped": skipped, "strengths": []}

    data = df[names].dropna()
    if data_fraction < 1:
        data = data.iloc[: max(10, int(len(data) * data_fraction))]
    idx = {v: i for i, v in enumerate(names)}
    taus = range(min_lag, max_lag + 1)

    assumptions: dict[int, dict] = {j: {} for j in range(len(names))}
    for j in range(len(names)):
        for tau in taus:
            assumptions[j][(j, -tau)] = "-?>"
    for a, b in usable:
        for tau in taus:
            assumptions[idx[b]][(idx[a], -tau)] = "-?>"

    pcmci = PCMCI(dataframe=pp.DataFrame(data.values, var_names=names), cond_ind_test=ParCorr())
    if method == "pc":
        res = pcmci.run_pcalg(link_assumptions=assumptions, tau_min=min_lag, tau_max=max_lag, pc_alpha=alpha)
    else:
        res = pcmci.run_pcmci(link_assumptions=assumptions, tau_min=min_lag, tau_max=max_lag, pc_alpha=alpha, alpha_level=alpha)
    p, graph, val = res["p_matrix"], res["graph"], res["val_matrix"]  # [i, j, tau]: i at t-tau -> j at t

    def lags_of(i: int, j: int) -> tuple[list[int], dict[int, float]]:
        ps = {tau: float(p[i, j, tau]) for tau in taus}
        return [tau for tau in taus if graph[i, j, tau] != ""], ps

    def strengths_of(a: str, b: str, lags: list[int]) -> list[dict]:
        return [{"source": a, "target": b, "lag": -tau, "value": float(val[idx[a], idx[b], tau])} for tau in lags]

    out, own, strengths = {}, {}, []
    for a, b in usable:
        lags, ps = lags_of(idx[a], idx[b])
        out[(a, b)] = {"lags": lags, "p": ps}
        strengths += strengths_of(a, b, lags)
    for v in names:
        own[v] = lags_of(idx[v], idx[v])[0]
        strengths += strengths_of(v, v, own[v])
    return {"links": out, "self": own, "skipped": skipped, "strengths": strengths}


def relag_graph(
    targets: dict[str, list[tuple[str, int]]],
    df: pd.DataFrame,
    method: Method = "pcmci",
    min_lag: int = 1,
    max_lag: int = 5,
    alpha: float = 0.01,
) -> tuple[dict[str, list[tuple[str, int]]], list[tuple[str, str]]]:
    """Keep the graph's variables and links; replace each link's lags with the discovered ones.

    Own-past lags are re-discovered only where the graph already has them. A link with no
    significant lag keeps its old lags and is reported, so you decide whether to drop it.
    Returns (new targets, links without evidence).
    """
    cross = sorted({(p, t) for t, ps in targets.items() for p, _ in ps if p != t})
    res = discover_lags(df, cross, min_lag, max_lag, alpha, method=method)
    found = res["links"]
    new: dict[str, list[tuple[str, int]]] = {}
    no_evidence = []
    for t, ps in targets.items():
        parents: dict[str, list[int]] = {}
        for p, lag in ps:
            parents.setdefault(p, []).append(abs(int(lag)))
        out: list[tuple[str, int]] = []
        for p, old in parents.items():
            lags = res["self"].get(t, []) if p == t else found.get((p, t), {}).get("lags", [])
            if not lags and p != t and (p, t) in found:
                no_evidence.append((p, t))
            out += [(p, -lag) for lag in (lags or old)]
        new[t] = out
    return new, no_evidence
