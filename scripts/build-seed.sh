#!/usr/bin/env bash
# `pnpm run build:stamped`, first stopping any build:seed already running in this checkout.
set -euo pipefail
# Job control puts the background build in its own process group, which is what the lock names.
set -m

cd "$(dirname "$0")/.."
mkdir -p build
lock=build/build-seed.pid

if [ -f "$lock" ]; then
  old=$(cat "$lock")
  # Claim the lock before the kill, so the superseded wrapper sees a foreign value and exits 0.
  echo "superseding-$$" > "$lock"
  if [[ "$old" =~ ^[0-9]+$ ]] && ps -o command= -p "$old" 2>/dev/null | grep -q 'run build'; then
    echo "build:seed: stopping the running build (process group $old)"
    kill -TERM -- "-$old" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 -- "-$old" 2>/dev/null || break
      sleep 1
    done
    kill -KILL -- "-$old" 2>/dev/null || true
  fi
fi

pnpm run build:stamped &
pgid=$!
echo "$pgid" > "$lock"
trap 'kill -TERM -- "-$pgid" 2>/dev/null || true' TERM INT

status=0
wait "$pgid" || status=$?

if [ "$(cat "$lock" 2>/dev/null)" != "$pgid" ]; then
  echo "build:seed: superseded by a newer build:seed"
  exit 0
fi
rm -f "$lock"
exit "$status"
