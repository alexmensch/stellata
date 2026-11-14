#!/usr/bin/env bash
# Runs <command…> once it holds one of HEAVY_SLOTS machine-wide slots, taken in arrival order, and load is below the core count.
set -uo pipefail

[ $# -gt 0 ] || { echo 'usage: heavy.sh <command…>' >&2; exit 2; }
. "$(dirname "$0")/run-queue.sh"

queue=${HEAVY_DIR:-${TMPDIR:-/tmp}/stellata-heavy}
slots=${HEAVY_SLOTS:-2}
cores=${HEAVY_CORES:-$(getconf _NPROCESSORS_ONLN)}
poll_s=${HEAVY_POLL_S:-5}
load_wait_s=${HEAVY_LOAD_WAIT_S:-600}

load() {
  if [ -n "${HEAVY_LOAD_CMD:-}" ]; then sh -c "$HEAVY_LOAD_CMD"
  elif [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg
  else sysctl -n vm.loadavg | awk '{print $2}'
  fi
}

mkdir -p "$queue"
me=
child=
cleanup() {
  [ -n "$child" ] && stop_group "$child"
  [ -n "$me" ] && rm -f "$me"
}
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 129' HUP
me=$(queue_register "$queue" "$*")

ahead() {
  local n=0 entry
  for entry in "$queue"/*; do
    [ "$entry" = "$me" ] && break
    if ! queue_live "$entry" heavy.sh; then
      echo "heavy: clearing the dead holder ${entry##*.} ($(cat "$entry" 2>/dev/null))" >&2
      rm -f "$entry"
    else
      n=$((n + 1))
    fi
  done
  echo "$n"
}

while [ "$(ahead)" -ge "$slots" ]; do sleep "$poll_s"; done

load_wait_start=$SECONDS
until awk -v l="$(load)" -v c="$cores" 'BEGIN { exit !(l < c) }'; do
  if [ $((SECONDS - load_wait_start)) -ge "$load_wait_s" ]; then
    echo "heavy: load $(load) still at or above $cores after ${load_wait_s}s; running anyway" >&2
    break
  fi
  sleep "$poll_s"
done

echo "heavy: running $*" >&2
# Job control gives the command its own process group, so stop_group reaches every descendant.
set -m
"$@" &
child=$!
status=0
wait "$child" || status=$?
child=
rm -f "$me"
exit "$status"
