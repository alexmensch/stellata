#!/usr/bin/env bash
# await-go: poll for a fresh operator-created .perf-go marker at the repo
# root. One stdout line and exit 0 when armed; exit 1 on timeout. Warns on
# stderr when other Claude sessions are busy in this repo.
# Protocol: README.md#the-protocol.

set -euo pipefail
here="$(dirname "$0")"
. "$here/perf-go-lib.sh"

poll_s="${PERF_GO_POLL_S:-15}"
timeout_s="${PERF_GO_TIMEOUT_S:-3600}"

marker="$(perf_go_marker)" || { echo "perf-go: not inside a git checkout" >&2; exit 1; }
started="$(date +%s)"

own_pids() {
  local p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    echo "$p"
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" || return 0
  done
}

busy_sessions() {
  local root agents
  root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  agents="$(claude agents --json 2>/dev/null)" || return 1
  # shellcheck disable=SC2046
  printf '%s' "$agents" | bash "$here/busy-sessions.sh" "$root" $(own_pids) || true
}

while :; do
  if [ -f "$marker" ] && age="$(perf_go_age_s "$marker")" && [ "$age" -le "$PERF_GO_MAX_AGE_S" ]; then
    if ! busy="$(busy_sessions)"; then
      echo "perf-go: WARNING — could not list Claude sessions (claude agents --json failed); busy-session check skipped." >&2
    elif [ -n "$busy" ]; then
      {
        echo "perf-go: WARNING — other Claude sessions are busy in this repo; a run now is likely discarded:"
        printf '%s\n' "$busy" | sed 's/^/  /'
      } >&2
    else
      echo "perf-go: ARMED — ${marker} (${age} s old). Launch the runner now; one arm authorises one launch."
      exit 0
    fi
    echo "perf-go: ARMED — ${marker} (${age} s old). Ask Alex about the warning above before launching; the arm holds until the marker ages out."
    exit 0
  fi
  if [ $(( $(date +%s) - started )) -ge "$timeout_s" ]; then
    echo "perf-go: no fresh marker after ${timeout_s} s — not armed. Re-announce and start await-go.sh again when Alex is ready." >&2
    exit 1
  fi
  sleep "$poll_s"
done
