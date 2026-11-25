"""The contract between the backend and the web (roadmap R20): the pydantic models and the TypeScript interfaces of the
same name in web/src/api (and dataset.ts) name the same fields, the permissive models of site.json's district and a
sink's demand (DistrictSettings) and of dataset.json (DatasetConfig) are in the OpenAPI schema, and every committed
example's site.json and dataset.json still load and are written back as they were. No code generator: the TS sources
are read as text."""

import json
import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from backend import schemas
from backend.app import create_app

APP = Path(__file__).resolve().parents[1]
WEB = APP / "web" / "src"
EXAMPLES = sorted((APP / "data").glob("sim_*"))
INTERFACE = re.compile(r"^export interface (\w+)(?:<[^>]*>)?(?: extends [^{]+)? \{\n(.*?)\n\}", re.S | re.M)


def ts_interfaces() -> dict[str, set[str]]:
    """Every exported interface of web/src/api/*.ts and dataset.ts: its top-level field names."""
    out: dict[str, set[str]] = {}
    for path in [*sorted((WEB / "api").glob("*.ts")), WEB / "dataset.ts"]:
        if path.name.endswith(".test.ts"):
            continue
        for name, body in INTERFACE.findall(path.read_text(encoding="utf-8")):
            assert name not in out, f"{name} is an interface twice in web/src: the test would compare only one"
            out[name] = set(re.findall(r"^  (?:readonly )?(\w+)\??:", body, re.M))
    return out


def models() -> dict[str, type[BaseModel]]:
    return {
        n: c
        for n, c in vars(schemas).items()
        if isinstance(c, type) and issubclass(c, BaseModel) and c.__module__ == schemas.__name__
    }


def test_the_shared_models_name_the_same_fields_as_the_web() -> None:
    ts, py = ts_interfaces(), models()
    shared = sorted(set(ts) & set(py))
    # the ones the contract is about must be among them (else a broken parser would pass with nothing compared)
    assert {"DistrictSettings", "DatasetConfig", "DatasetInfo", "Site", "HeatPoint", "PidView", "PidNote"} <= set(shared)
    drift = {n: (sorted(set(py[n].model_fields) - ts[n]), sorted(ts[n] - set(py[n].model_fields))) for n in shared}
    assert {n: d for n, d in drift.items() if d != ([], [])} == {}, "(only in pydantic, only in TypeScript)"


def test_openapi_describes_the_district_and_the_dataset_config() -> None:
    spec = create_app(APP / "data", None).openapi()["components"]["schemas"]
    assert set(spec["DistrictSettings"]["properties"]) == set(schemas.DistrictSettings.model_fields)
    assert set(spec["DatasetConfig"]["properties"]) == set(schemas.DatasetConfig.model_fields)
    assert spec["DistrictSettings"]["additionalProperties"] is True and spec["DatasetConfig"]["additionalProperties"] is True
    assert "DistrictSettings" in json.dumps(spec["Site"]) and "DistrictSettings" in json.dumps(spec["HeatPoint"])
    assert "DatasetConfig" in json.dumps(spec["DatasetInfo"])


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda p: p.name)
def test_every_example_site_and_dataset_json_loads_and_is_written_back_as_it_was(example: Path) -> None:
    for path in example.rglob("site.json"):
        raw = json.loads(path.read_text(encoding="utf-8"))
        back = json.loads(schemas.Site.model_validate_json(path.read_text(encoding="utf-8")).model_dump_json())
        assert json.dumps(back.get("district")) == json.dumps(raw.get("district")), path
        for was, now in zip([raw.get("source"), *raw.get("sinks", [])], [back.get("source"), *back["sinks"]], strict=True):
            assert json.dumps((now or {}).get("demand")) == json.dumps((was or {}).get("demand")), path
    config = example / "dataset.json"
    if config.exists():
        raw = json.loads(config.read_text(encoding="utf-8"))
        assert json.dumps(json.loads(schemas.DatasetConfig.model_validate(raw).model_dump_json())) == json.dumps(raw)


def test_a_permissive_model_keeps_what_it_does_not_expect() -> None:
    odd = {"houses": "12", "own": {"a": 1}, "heatingDay": [1, None, "x"], "kwhPerHouse": 9000}
    back = json.loads(schemas.DistrictSettings.model_validate(odd).model_dump_json())
    assert back == odd and list(back) == list(odd)  # the same keys in the same order, a value that does not fit kept
    assert schemas.DistrictSettings.model_validate({"houses": 100}).model_dump_json() == '{"houses":100}'  # not 100.0
    assert schemas.DatasetInfo.model_fields["config"].default_factory().model_dump() == {}
