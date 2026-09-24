#!/usr/bin/env bash
# skill-guard: PreToolUse hook on Skill / Edit / Write / NotebookEdit. Blocks
# an edit to a file a rule below names until that rule's skill has been
# invoked this session. See README.md § How skill-guard works.
#
# State scope: keyed on $PPID the way readme-guard is, for the same
# reasons. $GUARD_SESSION overrides it for a harness that spawns a fresh
# shell per call.

set -euo pipefail

. "$(dirname "$0")/skill-name.sh"

# required_skill <path> — the skill an edit to <path> needs, or nothing.
required_skill() {
  case "$1" in
    *.css) echo cube-css ;;
  esac
}

# why <skill> — what the skill carries that a folder README does not.
why() {
  case "$1" in
    cube-css) echo "Stylesheets here are CUBE CSS over Every Layout primitives: which layer a rule belongs in, why utilities carry !important and blocks may not, the no-width-media-query mandate, and the review gates (a hardcoded value on first use, a z-index where source order would do, a minmax() with no min(…, 100%) guard). A folder README documents the house style — which rule landed where, and why — not the system underneath it, so having read one is not having loaded the other.

Reach for the utopia skill alongside it when the change touches a type size, a space step or a clamp()." ;;
  esac
}

STATE_DIR="${TMPDIR:-/tmp}/claude-skill-guard"
mkdir -p "$STATE_DIR"
marker() { echo "$STATE_DIR/$1-${GUARD_SESSION:-$PPID}"; }

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

if [ "$tool" = "Skill" ]; then
  invoked="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""')"
  bare="$(skill_name "$invoked")"
  if [[ "$bare" =~ ^[A-Za-z0-9_-]+$ ]]; then : > "$(marker "$bare")"; fi
  exit 0
fi

file_path="$(printf '%s' "$input" | jq -r '
  .tool_input.file_path
  // .tool_input.notebook_path
  // .tool_input.path
  // ""
')"

skill="$(required_skill "$file_path")"
[ -n "$skill" ] || exit 0

state_file="$(marker "$skill")"
if [ -f "$state_file" ]; then exit 0; fi

reason="Refusing $tool on $(basename "$file_path") — invoke the $skill skill first this session.

$(why "$skill")

Fix: call the Skill tool with skill '$skill', then retry the edit.

If you have just done that and this still denies, your harness does not run PreToolUse on Skill calls: arm the session by creating $state_file and carry on — do not invoke the skill a third time. The same file is the opt-out where the rule genuinely does not apply to this file."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
