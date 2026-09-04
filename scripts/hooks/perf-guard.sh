#!/usr/bin/env bash
# perf-guard: PreToolUse hook on Bash / Write / Edit / NotebookEdit. Two
# independent gates — nothing the agent does may create the arm marker, and
# the runner may not launch without a fresh one.
# Protocol: scripts/perf/README.md § Human-armed.

set -euo pipefail

deny() {
  trap - ERR
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }' 2>/dev/null || { printf '%s\n' "$1" >&2; exit 2; }
  exit 0
}

# A consent gate fails CLOSED. An unhandled error would exit non-zero, which
# the harness reads as a broken hook and lets the call through — so every
# route out of this script other than an explicit pass is a denial.
trap 'deny "Refusing: perf-guard.sh failed unexpectedly near line ${LINENO}. Fix the hook rather than working around it."' ERR

. "$(dirname "$0")/../perf/perf-go-lib.sh"

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

marker="$(perf_go_marker)" || deny "Refusing: not inside a git checkout, so there is no repo root to look for the ${PERF_GO_MARKER_NAME} marker in."

marker_rule="Only Alex creates ${marker}, and it authorises exactly one launch — scripts/perf/README.md § Human-armed. This gate is unconditional: it does not check whether the command also launches the runner.

Naming the marker for another reason? A commit message or PR body goes through 'git commit -F <file>' / 'gh pr create --body-file <file>' (the route a worktree session already uses); searching the tree goes through the Grep tool."

protocol="The perf runner is human-armed — scripts/perf/README.md § Human-armed. The protocol, verbatim:
  1. Announce what you want to measure and why, with the exact command.
  2. Start the poller in the background: bash scripts/perf/await-go.sh  (Bash run_in_background).
  3. Proceed only when it reports the marker.
  4. Never create the marker. Alex arms a run with: touch ${marker}
     One arm authorises exactly one launch; the runner deletes the marker before the browser starts."

case "$tool" in
  Bash) ;;
  Write | Edit | NotebookEdit)
    path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
    if [ "$(basename "$path")" = "$PERF_GO_MARKER_NAME" ]; then
      deny "Refusing to write ${PERF_GO_MARKER_NAME}: arming yourself is the thing this hook prevents.

${marker_rule}

${protocol}"
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac

# Newlines become command separators, not spaces: a launch on its own line
# has no ';' or '&&' in front of it, and flattening to a space would leave it
# unmatched by CMD_START below.
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' | tr '\n' ';')"

if printf '%s' "$cmd" | grep -qF "$PERF_GO_MARKER_NAME"; then
  deny "Refusing: this command names ${PERF_GO_MARKER_NAME}, the perf runner's arm marker.

${marker_rule}

${protocol}"
fi

CMD_START='(^|[;&|(][[:space:]]*)'
ENV_PREFIX='(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
RUN_PATH='(\./)?scripts/perf/run(\.ts)?([[:space:]]|$|[;&|)])'
VIA_RUNNER="(pnpm[[:space:]]+(exec|dlx)[[:space:]]+)?(tsx|node|npx|bunx?|deno|pnpx)([[:space:]]+[^[:space:];&|]+)*[[:space:]]+${RUN_PATH}"
VIA_PKG='(pnpm|npm|yarn|bun)([[:space:]]+[^[:space:];&|]+)*[[:space:]]+perf([[:space:]]|$|[;&|)])'
DIRECT='\./scripts/perf/run\.ts([[:space:]]|$|[;&|)])'

printf '%s' "$cmd" | grep -qE "${CMD_START}${ENV_PREFIX}(${VIA_RUNNER}|${VIA_PKG}|${DIRECT})" || exit 0

[ -f "$marker" ] || deny "Refusing the perf runner: no ${PERF_GO_MARKER_NAME} marker at ${marker} — not armed.

${protocol}"

age="$(perf_go_age_s "$marker")" || deny "Refusing the perf runner: cannot read the age of ${marker}, so its freshness is unknown.

${protocol}"

if [ "$age" -gt "$PERF_GO_MAX_AGE_S" ]; then
  deny "Refusing the perf runner: the ${PERF_GO_MARKER_NAME} marker is ${age} s old, past the ${PERF_GO_MAX_AGE_S} s limit — a stale arm. Ask for a fresh one.

${protocol}"
fi

exit 0
