"""Causal graphs of a dataset: list, read, save, suggested drivers, and lag discovery for drawn links."""

from fastapi import APIRouter, HTTPException, Query

from ..core import dataset_files as files
from ..core.causal_discovery import discover_lags
from ..core.twin import default_drivers
from ..deps import Dataset, Registry, Structure, dataframe, derived_columns, graph_path, read_graph
from ..schemas import (
    CausalGraphFilesResponse,
    CausalGraphResponse,
    CausalGraphSaveRequest,
    CausalGraphSaveResponse,
    LagDiscoveryRequest,
)

router = APIRouter(prefix="/api/datasets", tags=["graphs"])


@router.get("/{dataset_id}/graph/files", response_model=CausalGraphFilesResponse, summary="List causal-graph files")
def list_graph_files(meta: Structure):
    """The dataset's causal-graph files (not site, dataset, equations or P&ID files)."""
    return CausalGraphFilesResponse(dataset_id=meta.id, files=files.graph_files(meta.directory))


@router.get("/{dataset_id}/graph", response_model=CausalGraphResponse, summary="Get a causal graph")
def get_graph(meta: Structure, source: str | None = Query(default=None)):
    """A graph file (default causal_graph.json; if that is missing, also when named: an empty graph, source null, so
    a new data center shows its variables with no links yet)."""
    if source in (None, "", files.CAUSAL_GRAPH) and not (meta.directory / files.CAUSAL_GRAPH).exists():
        return CausalGraphResponse(source=None, targets={}, link_strengths=[])
    path = graph_path(meta, source or files.CAUSAL_GRAPH)
    targets, strengths = read_graph(path)
    return {
        "source": path.name,
        "targets": {t: [{"parent": p, "lag": lag} for p, lag in ps] for t, ps in targets.items()},
        "link_strengths": strengths,
    }


@router.post("/{dataset_id}/graph/save", response_model=CausalGraphSaveResponse, summary="Save a causal graph")
def save_graph(meta: Structure, body: CausalGraphSaveRequest):
    """Write a graph file (any graph name; not site.json, dataset.json, ...)."""
    try:
        path = meta.directory / files.graph_name(body.file_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    targets = {t: [(i.parent, i.lag) for i in ps] for t, ps in body.targets.items()}
    edges = files.write_graph(path, targets, [s.model_dump() for s in body.link_strengths])
    return CausalGraphSaveResponse(dataset_id=meta.id, file_name=path.name, file_path=str(path), edge_count=edges)


@router.get("/{dataset_id}/graph/drivers", summary="Suggest drivers")
def suggested_drivers(meta: Structure, source: str = files.CAUSAL_GRAPH):
    """Variables whose only parents are their own past: suggested as inputs from the data (not derived columns)."""
    targets, _ = read_graph(graph_path(meta, source))
    derived = derived_columns(meta)
    return {"drivers": default_drivers(targets, [c for c in meta.columns if c not in derived])}


@router.post("/{dataset_id}/graph/discover-lags", summary="Discover the lags of drawn links (TempCaFe)")
def discover_link_lags(meta: Dataset, registry: Registry, body: LagDiscoveryRequest):
    """Keep the drawn links, learn which lags of each are significant. Nothing is written.

    link_strengths: the strength of every significant lag (own-past lags too) in the graph file's
    link_strengths shape, so a save after a discovery keeps them.
    """
    _, df = dataframe(registry, meta, body.file)
    try:
        res = discover_lags(
            df,
            [(link.source, link.target) for link in body.links],
            min_lag=body.min_lag,
            max_lag=body.max_lag,
            alpha=body.alpha,
            data_fraction=body.data_fraction,
            method=body.method,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "links": [{"source": a, "target": b, **v} for (a, b), v in res["links"].items()],
        "self": res["self"],
        "skipped": [{"source": a, "target": b} for a, b in res["skipped"]],
        "link_strengths": res["strengths"],
    }
