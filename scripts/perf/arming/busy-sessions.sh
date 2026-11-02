#!/usr/bin/env bash
# busy-sessions: read `claude agents --json` on stdin; print one line per
# session busy anywhere under this repo's main checkout, worktrees included.
# Usage: busy-sessions.sh <main-checkout-root> [<pid-to-exclude>...]

set -euo pipefail

root="${1:?usage: busy-sessions.sh <main-checkout-root> [<pid-to-exclude>...]}"
shift

exclude="$(jq -cn '$ARGS.positional | map(tonumber)' --args "$@")"

jq -r --arg root "$root" --argjson exclude "$exclude" '
  .[]
  | select(.status == "busy")
  | select(.cwd == $root or (.cwd | startswith($root + "/")))
  | select(.pid as $p | $exclude | index($p) | not)
  | "\(.name // .id) — \(.cwd)"
'
