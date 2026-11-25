"""Request and response models of the HTTP API (pydantic), one section per router.

The field descriptions show up in the OpenAPI reference at /api/docs. Lag convention: graph files
and saved models store lag = -k (-1 = one step back, 0 = same step); request fields that ask for
a lag *range* (min_lag, max_lag) take positive step counts.
"""

from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    ValidationError,
    field_validator,
    model_serializer,
    model_validator,
)

from .core.dataset_files import CAUSAL_GRAPH
from .core.limits import (
    COMPONENT_FIT_MAX_BYTES,
    COMPONENT_MAX_NODES,
    COMPONENT_MAX_STEPS,
    EVALUATE_MAX_HORIZON,
    LAG_DISCOVERY_MAX_LAG,
    SIMULATE_MAX_DRAWS,
    SIMULATE_MAX_STEPS,
    TRAIN_MAX_LAG,
)

# --- permissive models: what the web writes into dataset.json and site.json, described for OpenAPI -------------


class Permissive(BaseModel):
    """A file's object as the web writes it, described (OpenAPI, the field names the TS interfaces share) but taken as
    it is: keys of its own are kept (extra="allow"), a value that does not fit its field stays as it was (never a
    refusal: an older or hand-made file still loads), and only the keys it had are written back, in their order and
    unchanged."""

    model_config = ConfigDict(extra="allow", strict=True)
    _order: list[str] = PrivateAttr(default_factory=list)

    @field_validator("*", mode="wrap")
    @classmethod
    def _as_given(cls, value, handler):
        try:
            return handler(value)
        except ValidationError:
            return value

    @model_validator(mode="wrap")
    @classmethod
    def _keep_order(cls, data, handler):
        m = handler(data)
        m._order = list(data) if isinstance(data, dict) else list(m.model_fields_set)
        return m

    @model_serializer(mode="wrap")
    def _only_given(self, handler):
        given = self.model_fields_set | set(self.model_extra or {})
        return {k: getattr(self, k) for k in [*self._order, *sorted(given - set(self._order))] if k in given}


Num = int | float  # a number as written (100 stays 100, not 100.0)


class DistrictSettings(Permissive):
    """A district's heat-demand generator settings (site.json "district"; a heat sink's "demand" overrides some of
    them): web lib/demand.ts and api/site.ts DistrictSettings."""

    houses: Num | None = Field(default=None, description="Houses (dwellings) in the district")
    kwhPerHouse: Num | None = Field(default=None, description="Annual heat demand of one house, kWh/a")
    heatingLimit: Num | None = Field(default=None, description="°C: no space heating above this daily mean outdoor temperature")
    dhwShare: Num | None = Field(default=None, description="0..1, hot water share of the annual demand")
    morningPeak: Num | None = Field(default=None, description="0..1.5, weight of the morning peak")
    eveningPeak: Num | None = Field(default=None, description="0..1.5, weight of the evening peak")
    nightSetback: Num | None = Field(default=None, description="0..1, share the heating is turned down at night")
    weekendFactor: Num | None = Field(default=None, description="Demand on weekends relative to weekdays")
    supplyTemp: Num | None = Field(default=None, description="°C, the district network's supply")
    returnTemp: Num | None = Field(default=None, description="°C, the network's return")
    heatingDay: list[Num | None] | None = Field(default=None, description="The drawn typical day of heating (48 half hours)")
    hotWaterDay: list[Num | None] | None = Field(default=None, description="The drawn typical day of hot water (48 half hours)")
    included: bool | None = Field(default=None, description="Per heat sink: counted in the district total (default true)")
    profile: str | None = Field(default=None, description="A standard profile's id (web lib/profilePresets.ts); none: the curves")


class DatasetConfig(Permissive):
    """dataset.json, as the web reads it (web dataset.ts DatasetConfig)."""

    name: str | None = Field(default=None, description="The name shown")
    kind: str | None = Field(default=None, description="simulation, testbed or real")
    actuators: list[str] | None = Field(default=None, description="The variables the plant sets")
    heat: list[str] | None = Field(default=None, description="The heat variables")
    levers: list[str] | None = Field(default=None, description="Setpoints to evaluate")
    pid_image: str | None = Field(default=None, description="The P&ID picture, when there is one")
    heat_source: dict[str, dict[str, Any]] | None = Field(default=None, description="The heat-recovery options: q, t, ...")
    plant: dict[str, Any] | None = Field(default=None, description="How the plant is built (the example cases)")
    blank: bool | None = Field(default=None, description="A blank structure to draw (sim_blank)")
    frame: bool | None = Field(default=None, description="The built-in drawing inside the data center's box")
    derived: dict[str, dict[str, Any]] | None = Field(default=None, description="Calculated columns, Q = m · cp · ΔT")
    kpi: dict[str, Any] | None = Field(default=None, description="The variables of the data-center KPIs")
    prepared: list[dict[str, Any]] | None = Field(default=None, description="Prepared variables (Dashboard)")
    names: dict[str, str] | None = Field(default=None, description="Names shown in place of the variables' own")
    resampled: list[dict[str, Any]] | None = Field(default=None, description="Aggregated data files (Dashboard)")


# --- datasets ------------------------------------------------------------------------------


class TimeRange(BaseModel):
    """First and last timestamp of a dataset's first data file (ISO 8601)."""

    start: str = Field(description="First timestamp, ISO 8601")
    end: str = Field(description="Last timestamp, ISO 8601")


class DatasetInfo(BaseModel):
    """A dataset: one folder of app/data with at least one parquet file."""

    id: str = Field(description="Folder name; used in every /api/datasets/{dataset_id} URL")
    name: str = Field(description="Folder name made readable (dataset.json's 'name' is the display name)")
    files: list[str] = Field(description="Data file ids (parquet stems), sorted; the first is the default")
    columns: list[str] = Field(description="Variables of the first data file (without 'time')")
    time_range: TimeRange
    row_count: int = Field(description="Rows of the first data file")
    resolution_seconds: int | None = Field(description="The median step between rows, seconds; null without a time column")
    config: DatasetConfig = Field(default_factory=DatasetConfig, description="dataset.json ({} if missing)")


class DatasetsResponse(BaseModel):
    """Every dataset the app found in its data directory."""

    datasets: list[DatasetInfo]


class PreparedStep(BaseModel):
    """One prepared variable: a new column made from the data (core/prepare.py)."""

    model_config = ConfigDict(extra="forbid")  # a setting beside params instead of in it is refused, not ignored

    name: str = Field(description="Name of the new variable: a letter or _, then letters, digits or _")
    op: str = Field(
        description="mean, sum, min, max, product, difference, ratio (combine); scale, unit, log, sqrt, abs, diff, "
        "rolling_mean, shift, clip, fill_gaps, standardize (transform one); time_since_start, hour_of_day, day_of_week, "
        "month, day_of_year, is_weekend (time features); formula"
    )
    inputs: list[str] = Field(default=[], description="The variables it is made from (none for a time feature or a formula)")
    scope: Literal["dc", "heat", "district"] | None = Field(
        default=None,
        description="The part it is made for (none: the data center's): another part's is not on the data center's structure",
    )
    params: dict = Field(
        default={},
        description='scale {factor, offset}; unit {conversion: "K -> °C", "W -> kW", ...}; diff / shift {steps}; '
        "rolling_mean {window}; clip {min, max}; fill_gaps {method: interpolate | previous | zero | mean}; "
        'time_since_start {unit: seconds | minutes | hours | days}; formula {expr: "A[t] + B[t-1]"}',
    )


class ResampleRequest(BaseModel):
    """Aggregate a delivered data file to a coarser time step (core/resample.py)."""

    step: str = Field(description="15s, 1min, 15min, 1h or 1d")
    default: str = Field(
        default="mean", description="Method of the variables not in methods: mean, median, sum, min, max, last, drop"
    )
    methods: dict[str, str] = Field(default={}, description="Variable -> its method (drop: leave it out)")
    source: str | None = Field(default=None, description="The delivered data file; default: the first")
    name: str | None = Field(default=None, description="Name of the new data file; default <source>__<step>")


class WindowRequest(BaseModel):
    """Keep a time window of a delivered data file as a data file of its own (a big CSV is read in chunks)."""

    start: str = Field(description='First time kept, e.g. "2024-03-01" or "2024-03-01 06:00"')
    end: str = Field(description="First time no longer kept (the window is [start, end))")
    columns: list[str] = Field(default=[], description="The variables kept; empty: all")
    source: str | None = Field(default=None, description="The delivered data file; default: the first")
    name: str | None = Field(default=None, description="Name of the new data file; default <source>__<start>-<end>")


class PreparedPreview(BaseModel):
    """What a prepared variable would look like over one data file (nothing saved)."""

    name: str
    inputs: list[str]
    count: int
    missing: int
    mean: float | None
    std: float | None
    min: float | None
    max: float | None
    time: list[str] = Field(description="Bin start times of the downsampled series")
    values: list[float | None] = Field(description="Bin means")
    histogram: dict = Field(description="edges, counts")


class PreparedChange(BaseModel):
    """What changed: the step added (or null when removing), the whole recipe now, and the files written."""

    did: str
    step: PreparedStep | None
    recipe: list[PreparedStep]
    files: list[str] = Field(description="Files written or updated, relative to the data folder (version)")


class DataFolderEntry(BaseModel):
    """A data center of a data folder, from its folder name and dataset.json (no data loaded)."""

    id: str
    name: str
    kind: str = Field(description="dataset.json kind: simulation, testbed or real")
    example: bool = Field(default=False, description="One of the examples (app/data), listed in every project")


class DataVersionsResponse(BaseModel):
    """Which data folder the app reads: a version folder of the user's data root, or the examples ("local")."""

    current: str = Field(description='"local" (the examples, app/data) or the name of a version folder')
    versions: list[str] = Field(description="Version folders of the user's data root app/data_versions, natural order")
    names: dict[str, str] = Field(default_factory=dict, description='A version\'s own name (its project.json "name"), by folder')
    linked: bool = Field(description="Whether app/data_versions is linked on this machine")
    root: str | None = Field(description="The folder app/data_versions points at on this machine; null if not linked")
    folders: dict[str, list[DataFolderEntry]] = Field(description='The data centers of every version and of "local"')


class DataVersionRequest(BaseModel):
    """The data folder to switch to."""

    version: str = Field(description='"local" or one of the listed versions')


class FolderListing(BaseModel):
    """One folder of this computer for the data-folder picker: its sub-folders, never its files."""

    path: str = Field(description="The folder, absolute")
    parent: str | None = Field(description="The folder above it; null at the top")
    folders: list[str] = Field(description="Names of its visible sub-folders, natural order")
    versions: list[str] = Field(description="Its sub-folders named like version_1: non-empty for a data folder")


class PickedFolder(BaseModel):
    """The folder chosen in the operating system's folder dialog."""

    path: str | None = Field(description="Absolute path; null when the dialog was cancelled")


class FolderScan(BaseModel):
    """What a folder would bring as a new data center (core/import_folder.py scan); names relative to it."""

    id: str = Field(description="Suggested data-center id (from the folder name)")
    name: str
    kind: str
    data: list[str] = Field(description="Data files (.parquet, .csv)")
    drawing: str | None = Field(description="The P&ID file (DEXPI .xml, .svg or .pdf), if any")
    graphs: list[str]
    settings: str | None = Field(description="Its dataset.json, if any")


class ImportFolderRequest(BaseModel):
    """Add a data center from a folder into the data version open."""

    path: str = Field(min_length=1, description="Absolute path of the folder on this machine")
    id: str = Field(description="The new data center's id: lower-case letters, digits and _")
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["real", "simulation", "testbed"] = "real"
    read_pid: bool = Field(default=True, description="Read the folder's P&ID file as its P&ID")


class DataRootRequest(BaseModel):
    """The user's data folder: holds version_1, version_2, ..., each laid out like app/data."""

    path: str = Field(description="Absolute path of the folder on this machine", min_length=1)


# --- causal graphs -------------------------------------------------------------------------


class CausalParent(BaseModel):
    """One input of a variable in a causal graph."""

    parent: str = Field(description="Parent variable")
    lag: int = Field(description="Steps back, stored negative: -1 = previous step, 0 = same step")


class CausalLinkStrength(BaseModel):
    """A strength label on a link (e.g. a test statistic from discovery); display only."""

    source: str
    target: str
    lag: int = Field(description="Same convention as CausalParent.lag")
    value: float


class CausalGraphResponse(BaseModel):
    """A causal graph file: the parents of each target variable."""

    source: str | None = Field(default=None, description="File the graph was read from; null if there is none yet")
    targets: dict[str, list[CausalParent]] = Field(description="target variable -> its parents")
    link_strengths: list[CausalLinkStrength] = []


class CausalGraphFilesResponse(BaseModel):
    """The causal-graph files of a dataset."""

    dataset_id: str
    files: list[str] = Field(description="Graph file names, sorted (not site.json, dataset.json, equations.json, pid_plant.json)")


class CausalGraphSaveRequest(BaseModel):
    """A graph to write into the dataset folder."""

    file_name: str = Field(default=CAUSAL_GRAPH, description="Plain .json file name in the dataset folder")
    targets: dict[str, list[CausalParent]] = Field(description="target variable -> its parents")
    link_strengths: list[CausalLinkStrength] = []


class CausalGraphSaveResponse(BaseModel):
    """Where a graph was saved and how many links it has."""

    dataset_id: str
    file_name: str
    file_path: str = Field(description="Absolute path of the written file")
    edge_count: int = Field(description="Number of (parent, lag) links written")


class LinkRef(BaseModel):
    """A drawn link, parent -> target, without a lag."""

    source: str = Field(description="Parent variable")
    target: str = Field(description="Target variable")


class LagDiscoveryRequest(BaseModel):
    """Which lags of the drawn links are significant. Lags here are positive step counts (1 = one step back)."""

    links: list[LinkRef] = Field(description="The drawn links; only these (and each variable's own past) are tested")
    method: Literal["pcmci", "pc"] = Field(default="pcmci", description="tigramite algorithm")
    min_lag: int = Field(default=1, ge=1, le=LAG_DISCOVERY_MAX_LAG, description="Smallest lag tested, in steps")
    max_lag: int = Field(default=5, ge=1, le=LAG_DISCOVERY_MAX_LAG, description="Largest lag tested, in steps")
    alpha: float = Field(default=0.01, gt=0, lt=1, description="Significance level of the conditional-independence tests")
    data_fraction: float = Field(default=1.0, gt=0, le=1, description="Use only the first fraction of the rows (faster)")
    file: str | None = Field(default=None, description="Data file id; default: the dataset's first")


# --- training, evaluation, simulation ------------------------------------------------------


class TrainEstimate(BaseModel):
    """What a training request would fit, and roughly how long it takes (core/twin/estimate.py)."""

    models: int = Field(description="Variable models it fits: one per predicted variable")
    inputs: int = Field(description="Inputs of all of them together")
    rows: int
    train_rows: int
    seconds: float = Field(description="Best guess")
    low: float = Field(description="Faster end of the range")
    high: float = Field(description="Slower end of the range")
    variables: list[dict] = Field(description="Each modelled variable and its number of inputs")


class TrainRequest(BaseModel):
    """Fit one model per predicted variable and save it as models/{name}.json."""

    graph_file: str = Field(default=CAUSAL_GRAPH, description="Causal graph giving each variable's inputs (structure 'graph')")
    file: str | None = Field(default=None, description="Data file id; default: the dataset's first")
    drivers: list[str] | None = Field(
        default=None, description="Variables taken from the data instead of predicted; null = suggested from the graph"
    )
    split_fraction: float = Field(
        default=0.5, gt=0, lt=1, description="Share of the rows used for training; the rest is the test period"
    )
    name: str = Field(default="linear", description="Model name: letters, digits, _ and - (replaces a model of the same name)")
    structure: Literal["graph", "all"] = Field(
        default="graph", description="Inputs from the causal graph, or every variable (all vs all)"
    )
    max_lag: int = Field(default=5, ge=1, le=TRAIN_MAX_LAG, description="All vs all: inputs at lags 1..max_lag steps")
    variables: list[str] | None = Field(default=None, description="Variables the model may use; null = every column")
    model: Literal["linear", "xgboost", "physics", "symbolic", "tabpfn"] = Field(
        default="linear", description="Learner of each variable"
    )
    equations: dict[str, str] | None = Field(
        default=None, description="Physics only: {variable: right-hand side}, e.g. 'a*T[t-1] + b*P[t-1]'"
    )


class EquationCheck(BaseModel):
    """A physics equation to parse (nothing is fitted or saved)."""

    target: str = Field(description="Variable the equation predicts")
    expr: str = Field(description="Right-hand side; data as Var[t-k] (Var[t] = same step), any other name is a coefficient")


class EvaluateRequest(BaseModel):
    """Trained models to compare on the test period."""

    names: list[str] = Field(min_length=1, description="Model names (at least one)")
    levers: list[str] = Field(default=["Cool_Set"], description="Setpoint variables whose changes are scored")
    horizon: int = Field(default=168, ge=1, le=EVALUATE_MAX_HORIZON, description="Steps scored after each setpoint change")
    store: bool = Field(
        default=False,
        description="Also save the answer beside the models (models/evaluation.json): GET .../models/evaluation "
        "returns it while those models are unchanged",
    )


class Intervention(BaseModel):
    """A change applied to one variable during a simulation."""

    variable: str = Field(description="Driver or predicted variable of the model")
    kind: str = Field(pattern="^(set|shift|scale)$", description="set: fix the value; shift: add; scale: multiply its level")
    value: float = Field(description="New value (set), offset (shift) or factor (scale)")
    start: int = Field(default=0, ge=0, description="First step, as an offset from the simulation start")
    end: int | None = Field(default=None, ge=0, description="Step after the last (exclusive); null = to the end")


class SimulateRequest(BaseModel):
    """Run a trained model forward on its own predictions, with interventions."""

    start: int = Field(description="Row to start at (raised to the model's max lag if smaller)")
    steps: int = Field(default=24, ge=1, le=SIMULATE_MAX_STEPS, description="Rows to simulate (cut at the end of the data)")
    columns: list[str] = Field(default=[], description="Variables to return; empty = every variable of the model")
    interventions: list[Intervention] = Field(default=[], description="Changes applied during the run")
    n_draws: int = Field(default=1, ge=1, le=SIMULATE_MAX_DRAWS, description="> 1: noisy runs, returned as p05/p50/p95")
    baseline: bool = Field(default=False, description="Also return the run without interventions")
    drivers: dict[str, list[float]] = Field(
        default={},
        description="{driver: [values]}: series that replace a driver's data from the (raised) start on, one value "
        "per step, e.g. another dataset's weather or heat demand put in, as Heat Matching's Weather from / Heat demand "
        "from does. Only the model's drivers (get_model lists them; another variable is a 400); a shorter series "
        "leaves the rest as measured; interventions apply on top",
    )


# --- site ----------------------------------------------------------------------------------


class CompareRequest(BaseModel):
    """Roll several models over one period, the same way, with and without interventions (core/rolling.py)."""

    column: str = Field(description="The variable to compare (a model's predicted variable; the measurement scores it)")
    models: list[str] = Field(
        min_length=1, max_length=12, description="Trained models' names, and/or chronos-2 (the pretrained forecaster)"
    )
    mode: Literal["day_ahead", "free"] = Field(
        default="free", description="day_ahead: each day from the measured history before it; free: the period on the model's own"
    )
    start: int | None = Field(
        default=None,
        ge=0,
        description="First row (default: where the data's last calendar year starts); raised to the trained models' "
        "largest lag if smaller (the answer's start)",
    )
    steps: int | None = Field(default=None, ge=24, description="Rows (default: to the end of the data)")
    interventions: list[Intervention] = Field(default=[], description="Applied over the period; empty: no second run")


class Building(BaseModel):
    """The data center's building, picked on the map."""

    name: str
    osm_id: int | None = Field(default=None, description="OpenStreetMap way id, if picked from OSM")
    outline: list[tuple[float, float]] = Field(description="Closed ring of [lat, lon] points")


class HeatPoint(BaseModel):
    """A bubble on the map: the data center (source) or a heat sink."""

    id: str = Field(description="Unique within the site")
    name: str = Field(description="Label shown on the map")
    lat: float = Field(ge=-90, le=90, description="Degrees")
    lon: float = Field(ge=-180, le=180, description="Degrees")
    temp_c: float = Field(description="Supply (source) or required (sink) temperature, °C")
    power_kw: float = Field(ge=0, description="Heat power, kW")
    outline: list[tuple[float, float]] | None = Field(default=None, description="[lat, lon] ring of its building or drawn area")
    area: bool = Field(default=False, description="True: a whole district drawn on the map, one sink for all its buildings")
    demand: DistrictSettings | None = Field(default=None, description="Heat-demand generator settings of this sink")
    utilization: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description="The data center's IT utilization on average, 0..1 (missing: 1, full load)",
    )
    idle_share: float | None = Field(
        default=None, ge=0, le=1, description="The data center's power when idle, share of its capacity (power_kw; missing: 0.5)"
    )
    heat_used_share: float | None = Field(
        default=None, ge=0, le=1, description="The data center's: the share of its waste heat that is used (missing: 1)"
    )


class KpiMapping(BaseModel):
    """Which variables stand for the data-center KPIs (dataset.json "kpi"); leave out what the data does not have."""

    model_config = ConfigDict(extra="forbid")

    it_power: str | None = Field(default=None, description="The IT equipment's electric power (needed for every KPI)")
    cooling_power: str | None = Field(default=None, description="The cooling's electric power (PUE, ERF, ERE)")
    other_power: str | list[str] | None = Field(
        default=None,
        description="The facility's other electricity, summed over these (UPS and distribution losses, lighting, "
        "building): with it and the cooling, PUE is the full one, total facility / IT",
    )
    heat_power: list[str] = Field(default_factory=list, description="The reused heat, summed over these (ERF, ERE)")
    heat_demand: str | None = Field(default=None, description="The heat demand the reused heat covers")
    reuse: dict[str, str] | None = Field(
        default=None, description="Without heat_power: alternative heat-recovery points, option -> its heat (one counts)"
    )
    power_unit: Literal["W", "kW", "MW"] | None = Field(default=None, description="Unit of the powers (for energies)")


class PidShape(BaseModel):
    """One shape of a P&ID's digital construct (backend/pid/construct.py); positions are fractions of the drawing."""

    id: str = Field(description='Unique id, e.g. "comp:P4711", "inst:3", "pipe:12" or one you choose')
    kind: Literal["rect", "circle", "line", "text"]
    x: float | None = Field(default=None, description="rect / circle: centre; text: anchor (0..1 of the width)")
    y: float | None = Field(default=None, description="rect / circle: centre; text: anchor (0..1 of the height, down)")
    w: float | None = Field(default=None, description="rect / circle: width (fraction of the drawing's width)")
    h: float | None = Field(default=None, description="rect / circle: height (fraction of the drawing's height)")
    points: list[list[float]] | None = Field(default=None, description="line: [[x, y], ...], 2 or more")
    label: str = Field(default="", description="Tag or name shown with it (an instrument's ISA tag, a component's name)")
    role: Literal["component", "instrument", "pipe", "note", "drawing", ""] = Field(
        default="", description='What it stands for; "drawing": a line or text of the sheet itself, as read'
    )
    color: str | None = Field(default=None, description="Its own colour (#rrggbb), as on the sheet")
    props: dict[str, str | float] | None = Field(
        default=None,
        description='Its values, name -> number or text (design data: {"capacity_kW": 50, "type": "chiller"}); up to 30',
    )


class PidConstruct(BaseModel):
    """The drawing as editable shapes: level 2 between the picture and the variables."""

    shapes: list[PidShape] = Field(description="Every shape, bottom to top")
    saved: bool = Field(default=True, description="False: a first guess read from the drawing, not saved yet")
    picture: bool | None = Field(default=None, description="Whether the structure has a picture (pid.png); answers only")


class PidItem(BaseModel):
    """Where a variable's instrument sits on the P&ID, and its ISA tag."""

    x: float = Field(description="Position on the drawing")
    y: float = Field(description="Position on the drawing")
    tag: str = Field(default="?", description="ISA instrument tag, e.g. TT, FT")


class PidGroup(BaseModel):
    """Variables marked as one on the P&ID (e.g. the mean of a rack's CPUs): a mark only, no values are computed."""

    method: Literal["mean", "sum", "min", "max"] = Field(description="How the members would be combined")
    members: list[str] = Field(min_length=2, max_length=2000, description="The variables in the group")


class PidNote(BaseModel):
    """What a variable is, as the user or the assistant marked it on the P&ID (Physical structure page)."""

    kind: Literal["sensor", "setpoint", "actuator", "meter", "it_load", "weather", "time", "calculated", "status"] | None = Field(
        default=None, description="sensor (measured value), setpoint, actuator (controller output), meter, ..."
    )
    confidence: Literal["sure", "likely", "unsure"] | None = Field(default=None, description="How sure the marking is")
    note: str = Field(default="", max_length=500, description="Why, in a few words")
    group: PidGroup | None = Field(default=None, description="This variable stands for a group of others (a mark, no values)")


class VariableNames(BaseModel):
    """Names shown for variables in place of their own; the data and everything built on it keep their own names."""

    names: dict[str, str] = Field(description='{variable: name shown}; "" gives a variable its own name back')


class DocumentInfo(BaseModel):
    """What a document of the data center holds, and the view of the P&ID it is about (Physical structure › Documents)."""

    note: str = Field(default="", max_length=500, description="e.g. 'sensor list of the rack water loop'")
    view: str = Field(default="", max_length=40, description="The id of the P&ID view it is about; empty: the whole data center")


class DocumentText(BaseModel):
    """A text kept as a document of the data center (written by the user or an assistant)."""

    text: str = Field(description="The whole text (Markdown, CSV, JSON or plain text)")
    note: str = Field(default="", max_length=500, description="What it holds, in a few words")
    view: str = Field(default="", max_length=40, description="The id of the P&ID view it is about; empty: the whole data center")


class PidView(BaseModel):
    """An area of the P&ID marked as a view of its own (e.g. one cooling unit), with its own picture drawn inside it
    (pid_views/<id>.png). x, y, w, h are fractions of the P&ID; a view inside another view's area is nested in it."""

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,39}$", description="Its picture is pid_views/<id>.png")
    name: str = Field(min_length=1, max_length=80, description="Shown on the drawing and in the Views list")
    x: float = Field(ge=0, le=1, description="Left edge, fraction of the P&ID width")
    y: float = Field(ge=0, le=1, description="Top edge, fraction of the P&ID height")
    w: float = Field(gt=0, le=1, description="Width, fraction of the P&ID width")
    h: float = Field(gt=0, le=1, description="Height, fraction of the P&ID height")
    show: Literal["auto", "box", "sheet", "picture"] = Field(
        default="auto", description="Level of detail: a box, the sheet underneath, its picture; auto: a box when small on screen"
    )


class LatLon(BaseModel):
    """A point on the map."""

    lat: float = Field(ge=-90, le=90, description="Degrees")
    lon: float = Field(ge=-180, le=180, description="Degrees")


class Site(BaseModel):
    """site.json. Unknown keys are dropped: old files with "blocks" still load (without them)."""

    building: Building | None = Field(default=None, description="The data center's building")
    source: HeatPoint | None = Field(default=None, description="The data center as a heat source")
    sinks: list[HeatPoint] = Field(default=[], description="Heat consumers")
    pid_layout: dict[str, PidItem] = Field(default={}, description="variable -> its place on the P&ID")
    pid_notes: dict[str, PidNote] = Field(default={}, description="variable -> what it is and how sure (P&ID page)")
    pid_views: list[PidView] = Field(default=[], description="Areas of the P&ID shown as views of their own (P&ID page)")
    hex_option: Literal["condenser", "hall", "liquid"] = Field(
        default="condenser",
        description="Which heat exchanger recovers the heat (liquid: a liquid-cooled data center's rack water)",
    )
    district: DistrictSettings | None = Field(default=None, description="Heat-demand generator settings")
    heat_source_map: dict | None = Field(
        default=None, description="Heat distribution: which data columns are the data center's heat (web lib/sourceMap.ts)"
    )
    outdoor: Literal["data", "synthetic", "open-meteo"] = Field(
        default="data",
        description="Outdoor temperature of the heat demand: the data's column (else the synthetic year), "
        "the synthetic Frankfurt year, or Open-Meteo at the site",
    )
    heat_parts: dict[str, bool] | None = Field(
        default=None,
        description="Heat distribution: which parts are on, {hex, hp, tank} (a missing key is on; web pages/heat/parts.ts)",
    )
    twin_model: str | None = Field(
        default=None,
        description="The trained model this structure's part runs in Heat Matching (each structure its own "
        "site.json: the data center's, the heat distribution's, the district's; none: linear)",
    )
    heat_components: dict[str, str] | None = Field(
        default=None,
        description="Heat distribution: the component that replaces a part's built-in formula, {hex, hp, tank} -> component id "
        "(a missing key: the built-in formula; web pages/heat/partComponents.ts)",
    )
    network_station: LatLon | None = Field(
        default=None,
        description="Site map: the heat network's heat-pump station where it was placed by hand (none: where the plan puts "
        "it; web pages/district/HeatNetwork.tsx)",
    )


class StreetWay(BaseModel):
    """One OpenStreetMap way and what it is (web osm.ts streetKind)."""

    kind: Literal["road", "path", "sidewalk", "crossing"] = Field(
        description="road; path (footway, cycleway, track, pedestrian area); a road's sidewalk or crossing, mapped as a way "
        "of its own beside or across it (the heat network leaves those out: its pipe runs once, under the road)"
    )
    line: list[tuple[float, float]] = Field(description="[lat, lon] points; ways meet at a shared point")


class Streets(BaseModel):
    """The streets and paths around a site (streets.json, OpenStreetMap): where the Site map's heat network runs."""

    about: str = Field(default="", description="What the file holds")
    source: str = Field(description="Where the streets come from, with the licence (© OpenStreetMap contributors, ODbL)")
    bbox: tuple[float, float, float, float] = Field(description="The box they were fetched for: south, west, north, east")
    ways: list[StreetWay] = Field(description="The ways")


class Weather(BaseModel):
    """Hourly outdoor temperature at the site from Open-Meteo."""

    lat: float = Field(description="Latitude it was fetched for")
    lon: float = Field(description="Longitude it was fetched for")
    start: str = Field(description="First date, YYYY-MM-DD")
    end: str = Field(description="Last date, YYYY-MM-DD")
    source: str = Field(description="Where the numbers come from, with the licence")
    times: list[int] = Field(description="Unix seconds (UTC), hourly")
    temperature: list[float] = Field(description="temperature_2m, °C")


# --- project -------------------------------------------------------------------------------


class Project(BaseModel):
    """A whole project in one JSON document (format "dc-twin-project")."""

    format: str = Field(description='Must be "dc-twin-project"')
    version: int = 1
    dataset: str = Field(description="Id of the dataset the project belongs to")
    saved: str | None = Field(default=None, description="When it was saved, ISO 8601")
    files: dict[str, dict[str, str]] = Field(description='path in the dataset folder -> {"text": ...} or {"base64": ...} (.npz)')


class UiState(BaseModel):
    """What the user is looking at, as the page reports it."""

    client: str | None = Field(default=None, description="The reporting page's id: requests go to this page")
    focused: bool = Field(default=True, description="The tab is the one in front (a background tab does not take over)")
    route: str = Field(description='The open page, "<tab>/<sub>", e.g. "dc/pid"')
    dataset: str = Field(description="The open data center")
    data_version: str | None = Field(default=None, description='The data folder version, "local" for the examples')
    page: dict = Field(default={}, description="Page details: selected variable, map centre and zoom, unsaved edits, ...")


class UiStateResponse(BaseModel):
    """The user's screen, as last reported by the open page."""

    state: UiState | None = Field(description="null when no page has reported yet")
    seconds_ago: float | None = Field(description="Age of the report")
    pages: int = Field(description="How many pages of the app are open (listening)")


class PairCodeRequest(BaseModel):
    """Connect AI's request for a code: the page's proof that it listens (core/live.py Hub.stream)."""

    secret: str | None = Field(default=None, description="The secret of the page's event stream (its first message)")


class PairRequest(BaseModel):
    """The code the user read off the app's Connect AI button."""

    code: str = Field(min_length=1, max_length=20, description="The six digits Connect AI shows (spaces are ignored)")


class PairResult(BaseModel):
    """The token that lets this agent work the user's open page (ui_state, ui_snapshot, ui_do)."""

    connected: bool
    token: str = Field(description="Sent as the X-Agent-Token header; the MCP server keeps it by itself")


class UiCommand(BaseModel):
    """Something for the open page to do."""

    action: str = Field(description="click, fill, navigate, open_dataset, message, or a page gesture (see ui_do)")
    args: dict = Field(default={}, description='Arguments of the action, e.g. {"control": "Add link"}')


class UiCommandResult(BaseModel):
    """What the page did."""

    did: str = Field(description="What the page did, in words")
    route: str | None = Field(default=None, description="The page open afterwards")
    details: dict = Field(default={}, description="Action-specific details (the control pressed, the new value, ...)")


class SaveProjectRequest(BaseModel):
    """What goes into a saved project besides its files: the Site map's unsaved edits (they go in the file only)."""

    site: dict[str, Any] | None = Field(default=None, description="An unsaved site.json, in the file instead of the saved one")


class SavedProject(BaseModel):
    """Where a saved project state went."""

    path: str = Field(description="Path in the data folder, e.g. status/<dc>/<dc>-project-<time>.json")
    files: int = Field(description="Project files in it")


# --- components ----------------------------------------------------------------------------

COMPONENT_ID = r"^[A-Za-z0-9_-]{1,64}$"


class ComponentInput(BaseModel):
    """An exogenous input of a component."""

    name: str = Field(description="Name used in the equations as name[t] / name[t-k]")
    unit: str = Field(default="", description="Display unit")
    default: float = Field(default=0.0, description="Value when a run or a fit does not give it")


class ComponentNode(BaseModel):
    """An internal variable or output: one equation in the physics language."""

    name: str = Field(description="Name used in the equations")
    unit: str = Field(default="", description="Display unit")
    equation: str = Field(
        max_length=2000, description="Right-hand side over inputs, nodes ([t] same step, [t-k] k steps back) and parameters"
    )
    init: float = Field(default=0.0, description="Value before the first step (read by [t-k] references to this node)")


class ComponentParam(BaseModel):
    """A named number of the equations."""

    name: str = Field(description="Name used in the equations")
    value: float = Field(description="Its value")
    fixed: bool = Field(default=True, description="False: learned by 'Fit to my data'")
    unit: str = Field(default="", description="Display unit")
    note: str = Field(default="", description="What it is")


class Component(BaseModel):
    """A plant part as a small causal model: inputs, equations (nodes), outputs and parameters (core/components.py)."""

    id: str = Field(pattern=COMPONENT_ID, description="File name of a saved component; the preset id for a preset")
    name: str = Field(max_length=200, description="Display name")
    kind: Literal["heat_exchanger", "heat_pump", "storage", "data_center", "custom"] = Field(description="What part it models")
    inputs: list[ComponentInput] = Field(default=[], description="Exogenous inputs")
    nodes: list[ComponentNode] = Field(max_length=COMPONENT_MAX_NODES, description="Equations, one per node")
    outputs: list[str] = Field(default=[], description="Nodes other parts read")
    params: list[ComponentParam] = Field(default=[], description="Parameters")
    notes: str = Field(default="", description="Free text")
    source: str = Field(default="", description="Where the equations and numbers come from")
    preset: bool = Field(default=False, description="True for a built-in preset (read-only; set by the server)")


class ComponentsResponse(BaseModel):
    """The presets, then the user's saved components."""

    components: list[Component]


class ComponentSimulateRequest(BaseModel):
    """Run a component (as edited, need not be saved) over input series."""

    component: Component
    inputs: dict[str, float | list[float]] = Field(
        default={}, description="input -> a number (held) or a series; missing: its default"
    )
    steps: int | None = Field(default=None, ge=1, le=COMPONENT_MAX_STEPS, description="Steps when every input is a number")
    outputs: list[str] | None = Field(default=None, description="Compute only these nodes (and what they need); default: all")


class ComponentFitRequest(BaseModel):
    """Learn a component's non-fixed parameters from a CSV (sent only to this local app, not stored)."""

    component: Component
    csv: str = Field(max_length=COMPONENT_FIT_MAX_BYTES, description="CSV text with a header row; one row per step")
    mapping: dict[str, str] = Field(description="input or node name -> CSV column")
