#!/usr/bin/env bash
# busy-sessions: read `claude agents --json` on stdin; print one line per
# session busy anywhere under this repo's main checkout, worktrees included.
# Usage: busy-sessions.sh <main-checkout-root> [--pid <n> | --name <session>]...

set -euo pipefail

usage="usage: busy-sessions.sh <main-checkout-root> [--pid <n> | --name <session>]..."
root="${1:?$usage}"
shift

pids=()
names=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pid) pids+=("${2:?$usage}"); shift 2 ;;
    --name) names+=("${2:?$usage}"); shift 2 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done

exclude_pids="$(jq -cn '$ARGS.positional | map(tonumber)' --args ${pids[@]+"${pids[@]}"})"
exclude_names="$(jq -cn '$ARGS.positional' --args ${names[@]+"${names[@]}"})"

jq -r --arg root "$root" --argjson pids "$exclude_pids" --argjson names "$exclude_names" '
  .[]
  | select(.status == "busy")
  | select(.cwd == $root or (.cwd | startswith($root + "/")))
  | select(.pid as $p | $pids | index($p) | not)
  | select(.name as $n | $names | index($n) | not)
  | "\(.name // .id) — \(.cwd)"
'
