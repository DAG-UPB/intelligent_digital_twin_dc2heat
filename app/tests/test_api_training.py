"""Equations, and train / list / get / evaluate / simulate models over HTTP."""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from synthetic import make_frame, write_dataset

from backend.app import create_app
from backend.routers import training


def train(client: TestClient, api: str, **body) -> dict:
    r = client.post(f"{api}/models/train", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# --- equations ---------------------------------------------------------------------------


def test_equations_round_trip(client: TestClient, dataset_dir: Path, api: str) -> None:
    assert client.get(f"{api}/equations").json() == {"equations": {}}
    eqs = {"y": "a*y[t-1] + b*u[t-1]"}
    assert client.put(f"{api}/equations", json=eqs).json() == {"equations": eqs}
    assert json.loads((dataset_dir / "equations.json").read_text()) == eqs
    assert client.get(f"{api}/equations").json() == {"equations": eqs}
    r = client.put(f"{api}/equations", json={"nope": "1"})
    assert r.status_code == 400 and r.json()["detail"] == "Not data columns: ['nope']"


def test_equation_check(client: TestClient, api: str) -> None:
    ok = client.post(f"{api}/equations/check", json={"target": "y", "expr": "a*y[t-1] + b*u[t]"}).json()
    assert ok == {"ok": True, "uses": ["y[t-1]", "u[t]"], "coefficients": ["a", "b"]}
    bad = client.post(f"{api}/equations/check", json={"target": "y", "expr": "a*q[t-1]"}).json()
    assert bad == {"ok": False, "error": "q is not a data column"}
    own = client.post(f"{api}/equations/check", json={"target": "y", "expr": "a*y[t]"}).json()
    assert own == {"ok": False, "error": "y[t] cannot be on the right-hand side of its own equation"}


# --- train -------------------------------------------------------------------------------


def test_train_linear_and_read_it_back(client: TestClient, dataset_dir: Path, api: str) -> None:
    m = train(client, api)
    assert m["name"] == "linear" and m["kind"] == "linear" and m["order"] == ["y", "z"] and m["drivers"] == ["s", "u"]
    assert {
        k: m[k]
        for k in ("file", "graph_file", "requested_drivers", "structure", "max_lag_setting", "variables_used", "model_type")
    } == {
        "file": "df_sim_x",
        "graph_file": "causal_graph.json",
        "requested_drivers": ["u", "s"],
        "structure": "graph",
        "max_lag_setting": 5,
        "variables_used": ["u", "s", "y", "z"],
        "model_type": "linear",
    }
    coefs = {i["parent"]: i["coef"] for i in m["variables"]["y"]["inputs"]}
    assert abs(coefs["y"] - 0.8) < 0.05 and abs(coefs["u"] - 0.5) < 0.05 and abs(coefs["s"] - 0.3) < 0.05
    assert (dataset_dir / "models" / "linear.json").exists()
    assert client.get(f"{api}/models/linear").json() == m
    assert client.get(f"{api}/models").json() == {"models": ["linear"]}


def test_models_list_empty(client: TestClient, api: str) -> None:
    assert client.get(f"{api}/models").json() == {"models": []}


def test_train_all_vs_all_xgboost_physics(client: TestClient, dataset_dir: Path, api: str, monkeypatch) -> None:
    m = train(client, api, name="xgb_all", model="xgboost", structure="all", max_lag=2, variables=["u", "s", "y"])
    assert (
        m["structure"] == "all"
        and len(m["variables"]["y"]["inputs"]) == 6
        and (dataset_dir / "models/xgb_all.boosters/y.json").exists()
    )
    got = client.get(f"{api}/models/xgb_all")
    assert got.status_code == 200 and "_boosters" not in got.json() and got.json()["kind"] == "xgboost"
    # reading a model does not load its boosters (a TabPFN refit takes seconds)
    from backend.core import model_store

    monkeypatch.setattr(model_store, "_boosters", {})
    monkeypatch.setattr(model_store, "_load_boosters", lambda *a: pytest.fail("boosters loaded"))
    assert client.get(f"{api}/models/xgb_all").json() == got.json()
    p = train(client, api, name="phys", model="physics", equations={"y": "a*y[t-1] + b*u[t-1] + c*s[t-1]"})
    assert p["equations"] == {"y": "a*y[t-1] + b*u[t-1] + c*s[t-1]"} and abs(p["variables"]["y"]["params"]["a"] - 0.8) < 0.05
    # retraining under the same name with fewer variables leaves no stale boosters
    train(client, api, name="xgb_all", model="linear")
    assert not (dataset_dir / "models/xgb_all.boosters").exists()


def test_train_validates_the_name_before_fitting(client: TestClient, dataset_dir: Path, api: str, monkeypatch) -> None:
    from backend.core import twin

    monkeypatch.setattr(twin, "fit", lambda *a, **k: pytest.fail("fit ran"))
    r = client.post(f"{api}/models/train", json={"name": "a b"})
    assert r.status_code == 400 and r.json()["detail"] == "model name: letters, digits, _ and - only"
    assert not (dataset_dir / "models").exists()


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"model": "nope"}, 422),
        ({"split_fraction": 1.0}, 422),
        ({"max_lag": 49}, 422),
        ({"file": "nope"}, 404),
        ({"graph_file": "nope.json"}, 404),
        ({"graph_file": "site.json"}, 400),
        ({"drivers": ["u", "s", "y", "z"]}, 400),  # nothing left to model
        ({"model": "physics", "equations": {"y": "a*q[t-1]"}}, 400),
    ],
)
def test_train_errors(client: TestClient, api: str, body: dict, status: int) -> None:
    assert client.post(f"{api}/models/train", json=body).status_code == status


def test_untrained_model(client: TestClient, api: str) -> None:
    r = client.get(f"{api}/models/linear")
    assert r.status_code == 404 and r.json()["detail"] == "Model 'linear' not found — train it first"
    assert client.get(f"{api}/models/a.b").status_code == 400
    assert client.post(f"{api}/models/linear/simulate", json={"start": 0}).status_code == 404


# --- evaluate ----------------------------------------------------------------------------


def test_evaluate(client: TestClient, api: str) -> None:
    train(client, api)
    train(client, api, name="xgb", model="xgboost")
    r = client.post(f"{api}/models/evaluate", json={"names": ["linear", "xgb"], "levers": ["s"], "horizon": 24})
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d["models"]) == {"linear", "xgb"} and d["models"]["linear"]["free_r2"]["y"] > 0.9
    assert set(d["models"]["xgb"]) == {
        *("free_r2", "free_nmae", "free_mae", "free_wape", "free_mase", "nmae_test", "r2_test", "structure", "kind")
    }
    lin = d["models"]["linear"]
    # hourly data: MASE against the value 24 h earlier; a good free run beats it and its MAE is a fraction of y's size
    assert 0 < lin["free_mase"]["y"] < 1 and 0 < lin["free_wape"]["y"] < 1 and lin["free_mae"]["y"] > 0
    assert [e["start"] for e in d["events"]] == [300, 350, 400, 450, 500, 550]
    e = d["events"][1]
    assert e["lever"] == "s" and e["steps"] == 24 and len(e["time"]) == 24 and set(e["actual"]) == {"y", "z"}
    assert set(e["pred"]) == {"linear", "xgb"} and len(e["pred"]["linear"]["y"]) == 24 and set(e["rmse"]) == {"linear", "xgb"}
    assert (e["from"], e["to"]) == (0.0, 1.0)
    # a second call (other horizon) reuses the cached free run and gives the same scores
    again = client.post(f"{api}/models/evaluate", json={"names": ["linear"], "levers": ["s"], "horizon": 10}).json()
    assert again["models"]["linear"]["free_r2"] == d["models"]["linear"]["free_r2"] and again["events"][0]["steps"] == 10


def test_evaluation_is_stored_when_asked_and_read_back_while_its_models_are_unchanged(
    client: TestClient, dataset_dir: Path, api: str, monkeypatch
) -> None:
    train(client, api)
    train(client, api, name="xgb", model="xgboost")
    body = {"names": ["linear", "xgb"], "levers": ["s"], "horizon": 24}
    d = client.post(f"{api}/models/evaluate", json=body).json()
    assert client.get(f"{api}/models/evaluation").json() is None  # stored only when asked
    assert client.post(f"{api}/models/evaluate", json=body | {"store": True}).json() == d
    got = client.get(f"{api}/models/evaluation").json()
    assert {k: got[k] for k in ("names", "levers", "horizon", "models", "events")} == body | d
    # not a model, and no model may take its name
    assert client.get(f"{api}/models").json() == {"models": ["linear", "xgb"]}
    assert client.post(f"{api}/models/train", json={"name": "evaluation"}).status_code == 400
    # a git checkout gives the files new times, not new content: still the models it scored
    booster = dataset_dir / "models/xgb.boosters/y.json"
    os.utime(booster, (0, 0))
    (booster.parent / ".DS_Store").write_bytes(b"\0")  # nor does Finder's file beside the boosters
    assert client.get(f"{api}/models/evaluation").json() == got
    # a booster that changed (or a model gone) makes it stale
    booster.write_text(booster.read_text() + " ")
    assert client.get(f"{api}/models/evaluation").json() is None
    # too big to keep whole: the scores only
    monkeypatch.setattr(training, "EVALUATION_STORED_MAX_BYTES", 1000)
    client.post(f"{api}/models/evaluate", json=body | {"store": True})
    small = client.get(f"{api}/models/evaluation").json()
    assert small["events"] == [] and small["models"] == client.post(f"{api}/models/evaluate", json=body).json()["models"]


def test_evaluate_needs_names(client: TestClient, api: str) -> None:
    assert client.post(f"{api}/models/evaluate", json={"names": []}).status_code == 422
    assert client.post(f"{api}/models/evaluate", json={"names": ["nope"]}).status_code == 404


def test_evaluate_with_a_gap_is_not_a_500(tmp_path: Path) -> None:
    """A gap in a driver is filled along time (twin.simulate): the free run goes on and the events after it are scored."""
    df = make_frame()
    df.loc[420:425, "u"] = np.nan
    write_dataset(tmp_path / "gappy", df)
    client = TestClient(create_app(tmp_path))
    train(client, "/api/datasets/gappy")
    r = client.post("/api/datasets/gappy/models/evaluate", json={"names": ["linear"], "levers": ["s"], "horizon": 24})
    assert r.status_code == 200, r.text
    late = [e for e in r.json()["events"] if e["start"] > 425]
    assert late and late[0]["rmse"]["linear"]["y"] is not None and None not in late[0]["pred"]["linear"]["y"]


# --- simulate ----------------------------------------------------------------------------


def test_simulate(client: TestClient, api: str) -> None:
    train(client, api)
    r = client.post(f"{api}/models/linear/simulate", json={"start": 400, "steps": 30}).json()
    assert r["start"] == 400 and r["steps"] == 30 and len(r["time"]) == 30
    assert set(r["scenario"]) == {"s", "u", "y", "z"} and len(r["scenario"]["y"]) == 30 and set(r["actual"]) == set(r["scenario"])
    body = {
        "start": 400,
        "steps": 30,
        "columns": ["y"],
        "interventions": [{"variable": "s", "kind": "set", "value": 0.0}],  # s is 2 in the data there
        "n_draws": 3,
        "baseline": True,
    }
    r = client.post(f"{api}/models/linear/simulate", json=body).json()
    assert (
        set(r["scenario"]) == {"y"}
        and set(r["scenario"]["y"]) == {"p05", "p50", "p95"}
        and set(r["baseline"]["y"]) == {"p05", "p50", "p95"}
    )
    assert np.mean(r["scenario"]["y"]["p50"][-10:]) < np.mean(r["baseline"]["y"]["p50"][-10:])
    # the start is clamped to the model's max lag; the steps to the end of the data
    r = client.post(f"{api}/models/linear/simulate", json={"start": 0, "steps": 5}).json()
    assert r["start"] == 1
    assert client.post(f"{api}/models/linear/simulate", json={"start": 590, "steps": 50}).json()["steps"] == 10


def test_simulate_carries_a_moved_input_into_the_prepared_inputs_made_from_it(client: TestClient, api: str) -> None:
    """A shifted (or put-in) input moves the prepared variables made from it that the model takes too, as the
    outdoor temperature's 24 h mean does: before, the mean stayed the data's and the model saw a mix it never learned."""
    r = client.post(f"{api}/prepared", json={"name": "u_mean4", "op": "rolling_mean", "inputs": ["u"], "params": {"window": 4}})
    assert r.status_code == 200, r.text
    train(client, api, name="m", structure="all", variables=["u", "u_mean4", "y"], drivers=["u", "u_mean4"])
    run = lambda **b: client.post(f"{api}/models/m/simulate", json={"start": 400, "steps": 30, **b}).json()["scenario"]  # noqa: E731
    base = run()
    shifted = run(interventions=[{"variable": "u", "kind": "shift", "value": 2.0}])
    assert np.allclose(np.subtract(shifted["u"], base["u"]), 2.0)
    assert np.allclose(np.subtract(shifted["u_mean4"], base["u_mean4"])[3:], 2.0)  # its window full of shifted values
    put = run(drivers={"u": (np.asarray(base["u"]) + 2.0).tolist()})
    assert np.allclose(put["u_mean4"], shifted["u_mean4"]) and np.allclose(put["y"], shifted["y"])
    assert run(drivers={"u_mean4": [0.0] * 30})["u_mean4"] == [0.0] * 30  # a prepared input given itself stays as given


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"start": 400, "columns": ["nope"]}, 400),
        ({"start": 400, "interventions": [{"variable": "nope", "kind": "set", "value": 1}]}, 400),
        ({"start": 400, "interventions": [{"variable": "s", "kind": "double", "value": 1}]}, 422),
        ({"start": 600}, 400),
        ({"start": 400, "steps": 20001}, 422),
        ({"start": 400, "n_draws": 201}, 422),
        ({"start": 400, "drivers": {"nope": [1.0]}}, 400),
        ({"start": 400, "interventions": [{"variable": "s", "kind": "set", "value": 1, "start": -100}]}, 422),  # B-W5
        ({"start": 400, "interventions": [{"variable": "s", "kind": "set", "value": 1, "end": -1}]}, 422),
    ],
)
def test_simulate_errors(client: TestClient, api: str, body: dict, status: int) -> None:
    train(client, api)
    r = client.post(f"{api}/models/linear/simulate", json=body)
    assert r.status_code == status, r.text
    if body.get("columns") == ["nope"]:
        assert r.json()["detail"] == "Not in the model: ['nope']"


# --- derived (calculated) columns -------------------------------------------------------


def test_add_derived() -> None:
    from backend.core.derived import add_derived

    spec = {"Q": {"m": "m", "t_in": "a", "t_out": "b", "cp": 4.18}, "Q2": {"m": "m", "t_in": "a", "t_out": "nope", "cp": 1.0}}
    out = add_derived({"m": np.array([2.0, 0.5]), "a": np.array([30.0, 40.0]), "b": np.array([25.0, 30.0])}, spec)
    assert set(out) == {"Q"} and out["Q"] == pytest.approx([2 * 4.18 * 5, 0.5 * 4.18 * 10])  # a missing part: not derived


def test_derived_columns_are_calculated_not_modelled(tmp_path: Path) -> None:
    """A derived column (dataset.json "derived") is never a target, input or suggested driver; simulate computes it."""
    df = make_frame()
    df["q"] = df["z"] * 2.0 * (df["y"] - df["s"])
    cfg = {"kind": "simulation", "levers": ["s"], "actuators": ["s"], "heat": ["q"]}
    cfg["derived"] = {"q": {"m": "z", "t_in": "y", "t_out": "s", "cp": 2.0}}
    graph = {"y": [["y", -1], ["u", -1], ["s", -1]], "z": [["y", 0]], "q": [["y", -1]]}  # an old graph that still has q
    write_dataset(tmp_path / "sim_d", df, graph, cfg)
    client, api = TestClient(create_app(tmp_path, None)), "/api/datasets/sim_d"
    assert "q" not in client.get(f"{api}/graph/drivers").json()["drivers"]
    for structure in ("graph", "all"):
        m = train(client, api, structure=structure, max_lag=1)
        assert "q" not in m["order"] + m["drivers"] + m["variables_used"], structure
    train(client, api)
    r = client.post(f"{api}/models/linear/simulate", json={"start": 400, "steps": 20, "columns": ["q", "y", "z", "s"]}).json()
    sc = {k: np.array(v) for k, v in r["scenario"].items()}
    assert sc["q"] == pytest.approx(sc["z"] * 2.0 * (sc["y"] - sc["s"])) and r["actual"]["q"] == pytest.approx(df["q"][400:420])
    bands = client.post(f"{api}/models/linear/simulate", json={"start": 400, "steps": 20, "columns": ["q"], "n_draws": 3}).json()
    assert set(bands["scenario"]["q"]) == {"p05", "p50", "p95"}
    bad = client.post(
        f"{api}/models/linear/simulate", json={"start": 400, "interventions": [{"variable": "q", "kind": "set", "value": 1}]}
    )
    assert bad.status_code == 400  # a calculated column cannot be intervened on


def test_compare_counts_the_energy_at_the_median_step(tmp_path: Path) -> None:
    # B-W8: the first two rows a minute apart made every hour count as a minute
    df = make_frame()
    df.loc[0, "time"] = df.loc[1, "time"] - pd.Timedelta("1min")
    write_dataset(tmp_path / "sim_x", df)
    client = TestClient(create_app(tmp_path, None))
    api = "/api/datasets/sim_x"
    assert client.post(f"{api}/models/train", json={"name": "m", "model": "linear"}).status_code == 200
    r = client.post(f"{api}/models/compare", json={"column": "y", "models": ["m"], "mode": "free", "start": 0})
    assert r.status_code == 200, r.text
    body = r.json()
    measured = df["y"].to_numpy()[body["start"] : body["start"] + body["steps"]]
    assert body["measured_mwh"] == pytest.approx(measured.sum() / 1000)


def test_two_trainings_under_one_name_save_one_whole_model(client: TestClient, dataset_dir: Path, api: str, monkeypatch) -> None:
    # B-D5: the second training's boosters landed beside the first one's model file (or one removed the other's folder)
    import threading

    from backend.core import dataset_files

    first_saving, go_on = threading.Event(), threading.Event()
    write = dataset_files.write_atomic

    def slow_for_the_first(path, data):
        if path.name == "m.json" and '"structure": "all"' in data:  # the first training (routes run in a worker thread)
            first_saving.set()
            go_on.wait(5)
        write(path, data)

    monkeypatch.setattr(dataset_files, "write_atomic", slow_for_the_first)
    first = threading.Thread(
        name="first", target=train, args=(client, api), kwargs={"name": "m", "model": "xgboost", "structure": "all", "max_lag": 1}
    )
    first.start()
    assert first_saving.wait(30)
    second = threading.Thread(
        target=train, args=(client, api), kwargs={"name": "m", "model": "xgboost", "variables": ["u", "s", "y"]}
    )
    second.start()
    second.join(2)  # it waits for the first one's save
    go_on.set()
    first.join(30)
    second.join(30)
    m = json.loads((dataset_dir / "models/m.json").read_text())
    saved = sorted(p.stem for p in (dataset_dir / "models/m.boosters").iterdir())
    assert saved == sorted(m["order"]), (saved, m["order"])
    assert not [p for p in (dataset_dir / "models").iterdir() if p.name.startswith(".")]  # no temporary folder left


def test_a_failed_save_keeps_the_old_model_whole(client: TestClient, dataset_dir: Path, api: str, monkeypatch) -> None:
    train(client, api, name="m", model="xgboost", variables=["u", "s", "y"])
    before = sorted(p.name for p in (dataset_dir / "models/m.boosters").iterdir())
    import xgboost as xgb

    monkeypatch.setattr(xgb.Booster, "save_model", lambda self, f: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        client.post(f"{api}/models/train", json={"name": "m", "model": "xgboost", "structure": "all", "max_lag": 1})
    assert sorted(p.name for p in (dataset_dir / "models/m.boosters").iterdir()) == before
    assert not [p for p in (dataset_dir / "models").iterdir() if p.name.startswith(".")]


def test_compare_starts_after_the_models_lags_and_refuses_a_negative_start(client: TestClient, api: str) -> None:
    # B-W3: the run started at the model's largest lag, the measurement and the times at `start`: one step apart
    m = train(client, api, name="m", model="linear", max_lag=3, structure="all", variables=["u", "s", "y"])
    assert m["max_lag"] == 3
    body = {"column": "y", "models": ["m"], "mode": "free", "steps": 48}
    got = client.post(f"{api}/models/compare", json={**body, "start": 0}).json()
    at = client.post(f"{api}/models/compare", json={**body, "start": 3}).json()
    assert got["start"] == 3 and got["time"] == at["time"] and got["measured"] == at["measured"]
    assert got["runs"][0]["base"] == at["runs"][0]["base"]
    assert client.post(f"{api}/models/compare", json={**body, "start": -100}).status_code == 422


def test_a_model_whose_library_is_missing_is_left_out_of_evaluate_not_a_500(
    client: TestClient, dataset_dir: Path, api: str, monkeypatch
) -> None:
    """Without TabPFN (the container's default build) a saved TabPFN model is skipped with the reason; the rest scores."""
    import sys

    lin = train(client, api)
    models = dataset_dir / "models"
    (models / "tabpfn.json").write_text(json.dumps({**lin, "name": "tabpfn", "kind": "tabpfn"}))
    (models / "tabpfn.boosters").mkdir()
    for v in lin["order"]:
        np.savez(models / "tabpfn.boosters" / f"{v}.npz", X=np.zeros((3, 2)), y=np.zeros(3))
    monkeypatch.setitem(sys.modules, "torch", None)  # import torch raises ImportError

    r = client.post(f"{api}/models/evaluate", json={"names": ["linear", "tabpfn"], "levers": ["s"], "horizon": 24})
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d["models"]) == {"linear"} and "TabPFN is not installed" in d["skipped"]["tabpfn"]
    alone = client.post(f"{api}/models/evaluate", json={"names": ["tabpfn"]})
    assert alone.status_code == 501 and "TabPFN is not installed" in alone.json()["detail"]
    assert client.post(f"{api}/models/tabpfn/simulate", json={"start": 0}).status_code == 501
