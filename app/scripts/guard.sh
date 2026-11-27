#!/usr/bin/env bash
# Memory watchdog: runs a command, kills its whole process tree when their summed RSS goes over a limit, and
# prints the peak RSS and exit code at the end ("peak RSS: <n> MB, exit <rc>"). Exits with the command's code.
#
# Usage (from app/):
#   bash scripts/guard.sh ./start.sh                              # the app, under the default 8 GB limit
#   GUARD_MB=12288 bash scripts/guard.sh .venv/bin/python -m pytest -q -m slow
#
# GUARD_MB sets the limit in MB (default 8192). Optional: start.sh does not need it. RSS is sampled every 0.5 s,
# so a very fast spike can slip past it.
limit=${GUARD_MB:-8192}
"$@" & P=$!; peak=0
tree() { local k; for k in $(pgrep -P $1); do echo $k; tree $k; done; }
while kill -0 $P 2>/dev/null; do
  pids="$P $(tree $P)"; rss=$(ps -o rss= -p $(echo $pids | tr ' ' ',') 2>/dev/null | awk '{s+=$1} END{print int(s/1024)}')
  [ "${rss:-0}" -gt $peak ] && peak=$rss
  if [ "${rss:-0}" -gt "$limit" ]; then echo "GUARD: ${rss} MB, killing"; kill -9 $pids; fi
  sleep 0.5
done
wait $P; rc=$?; echo "peak RSS: ${peak} MB, exit $rc"; exit $rc
