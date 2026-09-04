#!/usr/bin/env bash
# perf-guard: PreToolUse hook on Bash. Denies launching the perf runner
# unless a fresh operator-created .perf-go marker sits at the repo root.
# Protocol: scripts/perf/README.md § Human-armed.

set -euo pipefail

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' | tr '\n' ' ')"

CMD_START='(^|[;&|(][[:space:]]*)'
ENV_PREFIX='(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
RUN_PATH='(\./)?scripts/perf/run(\.ts)?([[:space:]]|$|[;&|)])'
VIA_RUNNER="(pnpm[[:space:]]+(exec|dlx)[[:space:]]+)?(tsx|node|npx|bunx?|deno|pnpx)([[:space:]]+[^[:space:];&|]+)*[[:space:]]+${RUN_PATH}"
VIA_PNPM='pnpm([[:space:]]+run)?[[:space:]]+perf([[:space:]]|$|[;&|)])'
DIRECT='\./scripts/perf/run\.ts([[:space:]]|$|[;&|)])'

printf '%s' "$cmd" | grep -qE "${CMD_START}${ENV_PREFIX}(${VIA_RUNNER}|${VIA_PNPM}|${DIRECT})" || exit 0

. "$(dirname "$0")/../perf/perf-go-lib.sh"

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

marker="$(perf_go_marker)" || deny "Refusing the perf runner: not inside a git checkout, so there is no repo root to look for the .perf-go marker in."

protocol="The perf runner is human-armed — scripts/perf/README.md § Human-armed. The protocol, verbatim:
  1. Announce what you want to measure and why, with the exact command.
  2. Start the poller in the background: bash scripts/perf/await-go.sh  (Bash run_in_background).
  3. Proceed only when it reports the marker.
  4. Never create the marker. Alex arms a run with: touch ${marker}
     One arm authorises exactly one launch; the runner deletes the marker before the browser starts."

if printf '%s' "$cmd" | grep -q '\.perf-go'; then
  deny "Refusing: this command both touches .perf-go and launches the perf runner. Arming yourself is the thing this hook prevents.

${protocol}"
fi

[ -f "$marker" ] || deny "Refusing the perf runner: no .perf-go marker at ${marker} — not armed.

${protocol}"

age="$(perf_go_age_s "$marker")"
if [ "$age" -gt "$PERF_GO_MAX_AGE_S" ]; then
  deny "Refusing the perf runner: the .perf-go marker is ${age} s old, past the ${PERF_GO_MAX_AGE_S} s limit — a stale arm. Ask for a fresh one.

${protocol}"
fi

exit 0
