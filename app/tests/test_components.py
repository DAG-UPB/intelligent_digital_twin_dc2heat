"""Components (core/components.py, routers/components.py): check, graph, run and fit, on synthetic numbers only."""

import copy

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.core import components as core
from backend.core.component_library import PRESETS

HP = next(p for p in PRESETS if p["id"] == "hp_2mw")
TANK = next(p for p in PRESETS if p["id"] == "storage_tank")


def comp(nodes: list[tuple[str, str]], inputs=("u",), params=(("a", 0.5, False),), outputs=None) -> dict:
    """A small custom component."""
    return {
        "id": "c",
        "name": "c",
        "kind": "custom",
        "inputs": [{"name": i, "default": 1.0} for i in inputs],
        "nodes": [{"name": n, "equation": e} for n, e in nodes],
        "outputs": outputs or [nodes[-1][0]],
        "params": [{"name": n, "value": v, "fixed": f} for n, v, f in params],
    }


@pytest.mark.parametrize("preset", PRESETS, ids=[p["id"] for p in PRESETS])
def test_every_preset_checks_and_runs(preset: dict) -> None:
    res = core.check(preset)
    assert res["ok"], res["error"]
    run = core.simulate(preset, {}, steps=3)
    assert all(np.isfinite(run[o]).all() for o in preset["outputs"])


def test_check_reports_links_order_and_missing_parameters() -> None:
    res = core.check(comp([("y", "b * x[t] + a"), ("x", "u[t-2]")]))
    assert res["order"] == ["x", "y"]
    assert {"source": "u", "target": "x", "lag": 2} in res["links"]
    assert res["missing"] == ["b"] and not res["ok"] and "not a parameter: b" in res["error"]


@pytest.mark.parametrize(
    ("nodes", "error"),
    [
        ([("y", "a * x[t]"), ("x", "y[t]")], "algebraic loop"),
        ([("y", "a * y[t]")], "algebraic loop"),
        ([("y", "a * nope[t]")], "check the equation of y"),
        ([("y", "a * u[t"), ("z", "u[t]")], "check the equation of y"),
        ([("u", "a * u[t-1]")], "used twice"),
        ([("exp", "a * u[t]")], "cannot be a name"),
    ],
)
def test_check_finds_the_problem(nodes: list, error: str) -> None:
    assert error in core.check(comp(nodes))["error"]


def test_the_storage_graph_has_its_state_link() -> None:
    links = core.check(TANK)["links"]
    assert {"source": "E", "target": "E", "lag": 1} in links


def test_simulate_feedback_runs_step_by_step() -> None:
    # x[t] = a*x[t-1] + u[t], x before the start = 0
    c = comp([("x", "a * x[t-1] + u[t]")])
    run = core.simulate(c, {"u": [1.0, 1.0, 1.0, 0.0]})
    assert run["x"] == pytest.approx([1.0, 1.5, 1.75, 0.875])


def test_simulate_without_feedback_shifts_inputs_holding_the_first_value() -> None:
    run = core.simulate(comp([("y", "a * u[t-1]")]), {"u": [2.0, 4.0, 6.0]})
    assert run["y"] == pytest.approx([1.0, 1.0, 2.0])


def test_storage_energy_balance() -> None:
    run = core.simulate(TANK, {"Q_in": 500.0, "Q_out": 400.0}, steps=5)
    loss = 0.05 * ((70 + 40) / 2 - 10)
    assert run["E"] == pytest.approx([(100 - loss) * k for k in range(1, 6)])
    assert run["E_max"][0] == pytest.approx(100 * 1000 * 4.186 * 30 / 3600)


def test_heat_pump_carnot_cop_and_limits() -> None:
    run = core.simulate(HP, {"T_source": [30.0] * 4, "T_supply": [70.0, 72.0, 72.5, 80.0]})
    assert run["COP"][0] == pytest.approx(0.59 * 343.15 / 40)
    assert run["Q_max"] == pytest.approx([1690.0, 1690.0, 1690 * 0.5, 0.0])  # full at 72 °C, off 1 K above (a ramp)
    f = 1 - np.exp(-1 / 0.5)  # its output lags the set point: 1 h steps, τ 0.5 h, from a cold start
    assert run["Q_heat"][0] == pytest.approx(1690 * f)
    assert run["P_el"][0] == pytest.approx(1690 * f / run["COP"][0])


@pytest.mark.parametrize("hp", [p for p in PRESETS if p["kind"] == "heat_pump"], ids=lambda p: p["id"])
def test_a_heat_pump_gives_its_capacity_at_its_limits_and_its_defaults(hp: dict) -> None:
    # B-W6: the cited operating points sit on the limits (hp_2mw: 72 °C supply, its maximum)
    limit = {p["name"]: p["value"] for p in hp["params"]}
    at_limits = {"T_source": [limit["T_supply_max"] - limit["lift_max"]], "T_supply": [limit["T_supply_max"]]}
    assert core.simulate(hp, at_limits, outputs=["Q_max"])["Q_max"] == pytest.approx([limit["capacity"]])
    assert core.simulate(hp, {}, steps=1, outputs=["Q_max"])["Q_max"] == pytest.approx([limit["capacity"]])


def test_the_entu_exchanger_passes_no_more_than_offered() -> None:
    # B-W9: 1,041.7 kW passed of 1,000 kW offered at its own defaults
    hex_ntu = next(p for p in PRESETS if p["id"] == "hex_entu")
    run = core.simulate(hex_ntu, {"Q_hot": [1000.0, 200.0]}, outputs=["Q", "T_hot_out"])
    assert run["Q"][0] == pytest.approx(1000.0) and run["Q"][1] <= 200.0 + 1e-9
    assert run["T_hot_out"][0] == pytest.approx(45.0 - 10.0)  # the hot side cools by its dT_hot at the offered heat


def test_heat_pump_output_settles_on_its_set_point() -> None:
    run = core.simulate(HP, {"T_source": [30.0] * 12, "T_supply": [70.0] * 12})
    assert run["Q_heat"][0] < run["Q_heat"][1] < run["Q_heat"][-1]
    assert run["Q_heat"][-1] == pytest.approx(1690.0, rel=1e-6)


def test_simulate_only_what_the_outputs_need() -> None:
    run = core.simulate(HP, {}, steps=2, outputs=["COP"])
    assert set(run) == {"T_source", "T_supply", "load", "lift", "COP"}


@pytest.mark.parametrize(
    ("given", "steps", "error"),
    [({"nope": 1.0}, None, "not inputs"), ({"u": [1.0], "v": [1.0, 2.0]}, None, "same length"), ({}, 10**6, "steps must be")],
)
def test_simulate_bad_inputs(given: dict, steps: int | None, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        core.simulate(comp([("y", "a * u[t] + v[t]")], inputs=("u", "v")), given, steps)


def test_fit_recovers_the_carnot_efficiency() -> None:
    rng = np.random.default_rng(0)
    t_src, t_sup = rng.uniform(15, 35, 300), rng.uniform(60, 70, 300)
    cop = 0.47 * (t_sup + 273.15) / (t_sup - t_src) + rng.normal(0, 0.02, 300)
    res = core.fit(HP, {"T_source": t_src, "T_supply": t_sup, "COP": cop})
    assert res["learned"] == ["eta_C"]
    assert res["params"]["eta_C"] == pytest.approx(0.47, abs=0.005)
    assert res["params"]["capacity"] == 1690.0  # fixed
    assert res["quality"]["COP"]["r2"] > 0.95


def test_fit_through_an_unmeasured_node_and_a_measured_state() -> None:
    # storage: E measured, its loss coefficient learned through the unmeasured P_loss
    true = copy.deepcopy(TANK)
    next(p for p in true["params"] if p["name"] == "UA_loss")["value"] = 0.2
    q_in = np.random.default_rng(1).uniform(0, 300, 200)
    run = core.simulate(true, {"Q_in": q_in.tolist(), "Q_out": 100.0})
    res = core.fit(TANK, {"Q_in": q_in, "Q_out": np.full(200, 100.0), "E": np.array(run["E"])})
    assert res["params"]["UA_loss"] == pytest.approx(0.2, rel=0.05)


def test_fit_needs_a_measured_node_and_no_unmeasured_feedback() -> None:
    with pytest.raises(ValueError, match="map at least one node"):
        core.fit(HP, {"T_source": np.ones(5)})
    c = comp([("x", "a * x[t-1] + u[t]"), ("y", "x[t]")])
    with pytest.raises(ValueError, match="its own past through x"):
        core.fit(c, {"u": np.ones(5), "y": np.ones(5)})


def test_fit_with_nothing_to_learn_only_scores() -> None:
    res = core.fit(comp([("y", "a * u[t]")], params=(("a", 2.0, True),)), {"u": np.arange(5.0), "y": 2 * np.arange(5.0)})
    assert res["learned"] == [] and res["quality"]["y"]["r2"] == pytest.approx(1.0)


# --- API ---------------------------------------------------------------------------------------


def test_api_presets_save_get_delete(client: TestClient) -> None:
    listed = client.get("/api/components").json()["components"]
    assert {c["id"] for c in listed} >= {"hp_2mw", "storage_tank", "hex_approach"} and all(c["preset"] for c in listed)
    mine = {**client.get("/api/components/hp_2mw").json(), "name": "My HP"}
    assert client.put("/api/components/hp_2mw", json=mine).status_code == 400  # a preset id
    saved = client.put("/api/components/my_hp", json=mine)
    assert saved.status_code == 200 and saved.json()["id"] == "my_hp" and not saved.json()["preset"]
    assert client.get("/api/components/my_hp").json()["name"] == "My HP"
    assert client.delete("/api/components/my_hp").status_code == 200
    assert client.get("/api/components/my_hp").status_code == 404


def test_api_refuses_a_component_that_does_not_check(client: TestClient) -> None:
    bad = comp([("y", "a * x[t]"), ("x", "y[t]")])
    r = client.put("/api/components/bad", json=bad)
    assert r.status_code == 400 and "algebraic loop" in r.json()["detail"]
    assert client.post("/api/components/check", json=bad).json()["ok"] is False


def test_api_simulate_and_fit_a_csv(client: TestClient) -> None:
    c = comp([("y", "a * u[t]")])
    run = client.post("/api/components/simulate", json={"component": c, "inputs": {"u": [1, 2, 3]}}).json()
    assert run["series"]["y"] == pytest.approx([0.5, 1.0, 1.5])
    csv = "time;flow;out\n" + "\n".join(f"2024-01-01 0{i}:00;{i};{3 * i}" for i in range(1, 8))
    res = client.post("/api/components/fit", json={"component": c, "csv": csv, "mapping": {"u": "flow", "y": "out"}}).json()
    assert res["params"]["a"] == pytest.approx(3.0) and res["rows"] == 7


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        ({"csv": "a,b\n1,2", "mapping": {"u": "nope"}}, "Not columns of the CSV"),
        ({"csv": "a,b\nx,y", "mapping": {"u": "a"}}, "at least one column with numbers"),
        ({"csv": "a,b\n1,2\n3,4", "mapping": {"u": "a"}}, "map at least one node"),
    ],
)
def test_api_fit_bad_input(client: TestClient, body: dict, detail: str) -> None:
    r = client.post("/api/components/fit", json={"component": comp([("y", "a * u[t]")]), **body})
    assert r.status_code == 400 and detail in r.json()["detail"]
