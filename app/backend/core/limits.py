"""Memory and size limits, in one place so the 8 GB budget of the app can be reviewed together.

The app runs as one local process watched by an 8 GB RSS watchdog (scripts/guard.sh; 2 GB until 2026-11). The
model knobs below (TabPFN context size and inputs, prediction chunks, free-run length, symbolic regression rows and
the request caps on simulation and evaluation) were sized for the earlier 2 GB and stay until raised on purpose.
"""

# TabPFN (v2 weights): in-context learning on a sample of the training rows.
# Each fitted regressor keeps an attention cache of its context rows (~50 MB per variable at 500 rows, ~100 MB at
# 1000), on top of ~400 MB for TabPFN itself: 9 variables at 1000 rows went past the old 2 GB budget. Saved models with
# more rows are thinned to this many when loaded.
# ponytail: 500 rows and 1 estimator for speed and memory (~20 ms per prediction on CPU); raise if accuracy matters more
TABPFN_ROWS = 500
# memory grows with rows x inputs: 80 inputs (all vs all, lag 5) alone needs > 2 GB
TABPFN_MAX_INPUTS = 30
# rows per TabPFN predict call: one call over every row needs gigabytes of attention memory
TABPFN_CHUNK_ROWS = 1000
# a free run predicts step by step, so TabPFN's free run covers only the first 720 steps of the
# test period (30 days of hourly data)
TABPFN_FREE_STEPS = 720

# symbolic regression: gplearn sees at most this many training rows (every k-th)
# ponytail: for speed; raise if formulas look too coarse
SYMBOLIC_MAX_ROWS = 3000

# setpoint-change windows scored per lever; an evenly spaced subset when a lever moves all the time
# ponytail: e.g. a modulating valve; raise if needed
MAX_EVENTS = 50

# Simulations kept (routers/training.py), the latest ones: a page shown again, or asked twice at once by its parts,
# gets the same free run back until the model is saved again (a year of a few columns is ~1 MB each)
SIMULATIONS_KEPT = 8

# request caps: simulate allocates (variables x draws x steps) floats, plus a second run for the baseline
SIMULATE_MAX_STEPS = 20000
SIMULATE_MAX_DRAWS = 200
EVALUATE_MAX_HORIZON = 2000
# the evaluation stored beside the models (Evaluate, store): above this its setpoint windows are left out, the
# scores kept (a 24-step window of six models is ~0.5 MB; 50 changes x 2000 steps would be tens of MB)
EVALUATION_STORED_MAX_BYTES = 2 * 1024 * 1024
TRAIN_MAX_LAG = 48
# a lag written in an equation (core/physics.py): more than a year of 15-minute steps; beyond, a typo that overflows
# numpy's indexes
EQUATION_MAX_LAG = 100_000
LAG_DISCOVERY_MAX_LAG = 24

# delivered CSV data files (bronze): pandas holds a CSV at several times its size while parsing, so one bigger
# than this is listed from its header and ends only (core/csv_data.py) and never loaded
CSV_LOAD_MAX_BYTES = 200 * 1024 * 1024
CSV_CHUNK_ROWS = 10_000  # rows read at a time from a big CSV (measured: 2.4 GB, 280 columns to 1 h: 670 MB peak, 15 s)
CSV_WINDOW_MAX_CELLS = 20_000_000  # a time window of a big CSV, kept as a data file (~160 MB while it is made)

# any request body (routers' JSON: a site, a project with its models, prepared variables), refused by its
# Content-Length before it is read (app.py); the uploads have their own smaller caps below
REQUEST_MAX_BYTES = 200 * 1024 * 1024
# uploaded P&ID drawings (PDF/SVG/PNG): read whole into memory, so cap them
PID_MAX_BYTES = 50 * 1024 * 1024
# a PDF's compressed streams, inflated (pid/pdf_reader.py): one stream, and all of one reading (its forms each time
# they are placed); a large real P&ID inflates to a few MB, a 199 kB zip bomb to 350 MB
PDF_STREAM_MAX_BYTES = 32 * 1024 * 1024
PDF_INFLATE_MAX_BYTES = 128 * 1024 * 1024
# reading one drawing (pid/extract.py read_drawing): parts of it grow faster than the drawing; a large real P&ID
# (~8000 lines) reads in seconds, 75,000 short lines did not finish in 170 s
PID_READ_TIMEOUT_S = 60.0
# the user's documents about a data center (any file, kept as it is): read whole into memory, so cap them
DOC_MAX_BYTES = 50 * 1024 * 1024

# Open-Meteo weather for the evaluated period: one request covers at most this many days (the period is at most
# 20000 steps, ~2.3 years of hourly data)
WEATHER_MAX_DAYS = 1000

# Wärmeatlas buildings (core/waermeatlas.py): one request reads only one map box from the local SQLite.
# Central Frankfurt has ~1500 buildings per km², so a 2 km box is the most a map tab should draw at once.
WAERMEATLAS_MAX_BOX_KM = 2.0
WAERMEATLAS_MAX_BUILDINGS = 3000
WAERMEATLAS_MAX_LINES = 3000
PFA_MAX_BOX_KM = 40.0  # the Plattform für Abwärme's sources: few (~800 in Rhein-Main), a whole region at once
PFA_MAX_SOURCES = 2000  # the PfA's sources per box, the largest first
# the electricity market's hours one request returns (core/market.py, GET /api/market/hourly): three years
MARKET_MAX_HOURS = 3 * 8784

# machine-local map examples (core/map_examples.py, `_local/map_examples.json`): read whole, so cap the file
MAP_EXAMPLES_MAX_BYTES = 1024 * 1024

# components (core/components.py): a run or a fit holds a few arrays of this many steps; the fit's CSV is read whole
COMPONENT_MAX_STEPS = 20000
COMPONENT_MAX_NODES = 50
COMPONENT_FIT_MAX_BYTES = 20 * 1024 * 1024
COMPONENT_FIT_MAX_ROWS = 100_000

# MCP server (backend/mcp_server.py): an LLM reads every tool result, so long answers (a full time series) are cut;
# the P&ID view is scaled to what a vision model reads in one image (zoom into a region for small text)
MCP_TEXT_MAX_CHARS = 60_000
MCP_PID_VIEW_MAX_PX = 1600
MCP_CALL_TIMEOUT_S = 900  # training TabPFN or XGBoost on a long period takes minutes

# the digital construct of a P&ID (pid/construct.py): shapes the page draws and an agent edits; a real sheet has a
# few hundred pipe runs and components
PID_CONSTRUCT_MAX_SHAPES = 20000  # every line of a sheet is a shape (a large P&ID has ~8000)
PID_CONSTRUCT_MAX_POINTS = 500

# MCP over HTTP (routers/mcp.py): sessions kept, each a few bytes (its agent's token); the oldest go first
MCP_SESSIONS_MAX = 100
