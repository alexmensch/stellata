#!/usr/bin/env bash
# await-go: poll for a fresh operator-created .perf-go marker at the repo
# root. One stdout line and exit 0 when armed; exit 1 on timeout.
# Protocol: README.md § Human-armed.

set -euo pipefail
. "$(dirname "$0")/perf-go-lib.sh"

poll_s="${PERF_GO_POLL_S:-15}"
timeout_s="${PERF_GO_TIMEOUT_S:-3600}"

marker="$(perf_go_marker)" || { echo "perf-go: not inside a git checkout" >&2; exit 1; }
started="$(date +%s)"

while :; do
  if [ -f "$marker" ] && age="$(perf_go_age_s "$marker")" && [ "$age" -le "$PERF_GO_MAX_AGE_S" ]; then
    echo "perf-go: ARMED — ${marker} (${age} s old). Launch the runner now; one arm authorises one launch."
    exit 0
  fi
  if [ $(( $(date +%s) - started )) -ge "$timeout_s" ]; then
    echo "perf-go: no fresh marker after ${timeout_s} s — not armed. Re-announce and start await-go.sh again when Alex is ready." >&2
    exit 1
  fi
  sleep "$poll_s"
done
