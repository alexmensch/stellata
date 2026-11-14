#!/usr/bin/env bash
# `pnpm run worktree:include` then `pnpm run build:data` through heavy.sh's gate, first stopping every older build:seed in this checkout.
set -euo pipefail
# Job control puts the build in its own process group, so one signal stops all of it.
set -m

cd "$(dirname "$0")/.."
. scripts/run-queue.sh
runs=build/build-seed
mkdir -p "$runs"
me=
build=

stop_build() {
  [ -n "$build" ] && stop_group "$build"
  [ -n "$me" ] && rm -f "$me"
}
trap 'stop_build; echo "build:seed: superseded by a newer build:seed"; exit 0' TERM
trap 'stop_build; exit 130' INT
trap 'stop_build; exit 129' HUP

# Register before scanning: of two concurrent runs, at least one then sees the other.
me=$(queue_register "$runs" '')
ticket=${me##*/}
ticket=${ticket%.*}
for entry in "$runs"/*; do
  [ "$entry" = "$me" ] && continue
  name=${entry##*/}
  pid=${name##*.}
  if ! queue_live "$entry" build-seed.sh; then
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

{ pnpm run worktree:include && bash scripts/heavy.sh pnpm run build:data; } &
build=$!
status=0
wait "$build" || status=$?
rm -f "$me"
exit "$status"
