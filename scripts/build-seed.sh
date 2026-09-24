#!/usr/bin/env bash
# `pnpm run build:stamped`, first stopping every older build:seed in this checkout.
set -euo pipefail
# Job control puts the build in its own process group, so one signal stops all of it.
set -m

cd "$(dirname "$0")/.."
runs=build/build-seed
mkdir -p "$runs"
ticket=$(python3 -c 'import time; print(time.time_ns())')
me="$runs/$ticket.$$"
build=

stop_build() {
  if [ -n "$build" ]; then
    kill -TERM -- "-$build" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 -- "-$build" 2>/dev/null || break
      sleep 1
    done
    kill -KILL -- "-$build" 2>/dev/null || true
  fi
  rm -f "$me"
}
trap 'stop_build; echo "build:seed: superseded by a newer build:seed"; exit 0' TERM
trap 'stop_build; exit 130' INT
trap 'stop_build; exit 129' HUP

# Register before scanning: of two concurrent runs, at least one then sees the other.
: > "$me"
for entry in "$runs"/*; do
  [ "$entry" = "$me" ] && continue
  name=${entry##*/}
  pid=${name##*.}
  if ! ps -o command= -p "$pid" 2>/dev/null | grep -q build-seed.sh; then
    rm -f "$entry"
  elif [ "${name%.*}" -gt "$ticket" ]; then
    rm -f "$me"
    echo "build:seed: superseded by a newer build:seed"
    exit 0
  else
    echo "build:seed: stopping the older build:seed ($pid)"
    kill -TERM "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null; do sleep 1; done
  fi
done

pnpm run build:stamped &
build=$!
status=0
wait "$build" || status=$?
rm -f "$me"
exit "$status"
