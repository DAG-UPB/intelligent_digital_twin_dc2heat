# The app in one container: the page (Node), the docs (Sphinx), then the Python process that serves both.
#
#   docker compose up --build              the examples only, http://localhost:7612 (compose.yaml)
#   IDT_DATA=/path/to/data docker compose up --build data     a data folder, http://localhost:7600
#
# Build args: ML=1 also installs TabPFN, torch and Chronos-2 (several GB; without them those models say they are
# not installed, everything else works). UID: the user the app runs as (match the owner of a mounted data folder).

FROM node:22-bookworm-slim AS web
WORKDIR /src/app/web
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/web ./
# the AI assistant page shows the agent wiki (WikiCard.tsx reads ../../wiki at build time)
COPY wiki /src/wiki
RUN npm run build

FROM python:3.12-slim-bookworm AS docs
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /uvx /bin/
WORKDIR /src
# the docs include code by literalinclude: the whole (filtered) context
COPY . .
RUN uvx --with-requirements docs/requirements.txt --from sphinx sphinx-build -W --keep-going -q -b html docs docs/_build/html

FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /bin/
# XGBoost needs the OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
ARG UID=1000
RUN useradd --create-home --uid "$UID" app

ARG ML=0
# as CI's install: without TabPFN/torch (imported only when their model runs) unless ML=1
ARG HEAVY="tabpfn torch triton mlx mlx-metal cuda-bindings cuda-pathfinder cuda-toolkit nvidia-cublas nvidia-cuda-cupti \
nvidia-cuda-nvrtc nvidia-cuda-runtime nvidia-cudnn-cu13 nvidia-cufft nvidia-cufile nvidia-curand nvidia-cusolver \
nvidia-cusparse nvidia-cusparselt-cu13 nvidia-nccl-cu13 nvidia-nvjitlink nvidia-nvshmem-cu13 nvidia-nvtx"
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1
WORKDIR /app/app
COPY --chown=app app/pyproject.toml app/uv.lock app/.python-version ./
RUN if [ "$ML" = 1 ]; then uv sync --frozen --no-dev; \
    else uv sync --frozen --no-dev --no-group foundation $(printf -- '--no-install-package %s ' $HEAVY); fi

WORKDIR /app
COPY --chown=app . .
COPY --chown=app --from=web /src/app/web/dist app/web/dist
COPY --chown=app --from=docs /src/docs/_build/html docs/_build/html
# data mode: the mounted data folder is the app's data_versions link (as scripts/link-data.sh makes it)
RUN mkdir /data && chown app /data /app/app && ln -s /data app/data_versions && chown -h app app/data_versions

USER app
WORKDIR /app/app
ENV PATH="/app/app/.venv/bin:$PATH" \
    PORT=7612 IDT_HOST=0.0.0.0 \
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    OTEL_SDK_DISABLED=true HF_HUB_DISABLE_TELEMETRY=1 PYTHONUNBUFFERED=1
EXPOSE 7612 7600
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ[\"PORT\"]}/health', timeout=4)"
# IDT_MODE=data: the data folder mounted at /data (a version_1 made in an empty one, as start.sh does);
# else the examples only (scripts/examples_app.py, as ./start.sh examples)
CMD if [ "$IDT_MODE" = data ]; then \
      ls -d /data/version_* >/dev/null 2>&1 || mkdir -p /data/version_1; \
      exec uvicorn backend.main:app --host "$IDT_HOST" --port "$PORT"; \
    else exec python scripts/examples_app.py "$PORT"; fi
