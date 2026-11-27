#!/usr/bin/env bash
# Build the page when its sources changed, then run a single Python process on http://localhost:7600.
# `./start.sh examples`: the app on the examples only (no data folder, no real data) on http://localhost:7612.
# Once it answers, the browser opens on the Site map with Case 1 (the 5 MW example at the European Central Bank);
# NO_BROWSER=1 skips that (agents, tests). The first start of a new person makes their project folder (below).
set -e
cd "$(dirname "$0")"

# Every core for XGBoost and numpy (OMP_NUM_THREADS etc. unset); TabPFN's torch keeps one thread (learners.py).
# Nothing about the data leaves this machine: no telemetry from FastAPI/OpenTelemetry or Hugging Face.
export OTEL_SDK_DISABLED=true HF_HUB_DISABLE_TELEMETRY=1

# (re)build when there is no build, or any page source is newer than it
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html -newer web/dist/index.html -print -quit)" ]; then
  (cd web && npm install && npm run build)
fi

uv sync --quiet
# a new person (no data folder linked yet): their project folder is made and linked, version_1 in it; the examples
# are in every project. IDT_DATA chooses where (default ~/Documents/DC2HEAT-data); "Set data folder…" changes it later.
if [ "${1:-}" != "examples" ] && [ ! -e data_versions ]; then
  folder="${IDT_DATA:-$HOME/Documents/DC2HEAT-data}"
  mkdir -p "$folder/version_1"
  bash scripts/link-data.sh "$folder" >/dev/null
  echo "Your project folder: $folder (version_1); the app saves your work there."
fi
port="${PORT:-7600}"
[ "${1:-}" = "examples" ] && port="${PORT:-7612}"
if [ -z "${NO_BROWSER:-}" ]; then
  url="http://localhost:${port}/?case=1#/twin/map"
  opener="$(command -v open || command -v xdg-open || true)"
  if [ -n "$opener" ]; then
    (for _ in $(seq 1 120); do curl -sf "http://localhost:${port}/health" >/dev/null 2>&1 && { "$opener" "$url" >/dev/null 2>&1; break; }; sleep 1; done) &
  fi
fi
if [ "${1:-}" = "examples" ]; then
  exec uv run --no-sync python scripts/examples_app.py "$port"
fi
exec uv run --no-sync uvicorn backend.main:app --port "$port"
