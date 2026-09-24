#!/usr/bin/env bash
# css-skill-guard: PreToolUse hook on Skill / Edit / Write / NotebookEdit.
# Blocks edits to *.css until the cube-css skill has been invoked this
# session. The skill carries the layout system the stylesheets are written
# in — the cascade layers, the no-width-query mandate, the review gates —
# a README describing the house style reads convincingly like coverage of
# the system underneath it, which is what makes the load look redundant.
#
# State scope: keyed on $PPID the way readme-guard is, for the same
# reasons. $GUARD_SESSION overrides it for a harness that spawns a fresh
# shell per call.

set -euo pipefail

. "$(dirname "$0")/skill-name.sh"

STATE_DIR="${TMPDIR:-/tmp}/claude-css-skill-guard"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/loaded-${GUARD_SESSION:-$PPID}"

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

if [ "$tool" = "Skill" ]; then
  skill="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""')"
  if is_skill "$skill" cube-css; then : > "$STATE_FILE"; fi
  exit 0
fi

file_path="$(printf '%s' "$input" | jq -r '
  .tool_input.file_path
  // .tool_input.notebook_path
  // .tool_input.path
  // ""
')"

case "$file_path" in
  *.css) ;;
  *) exit 0 ;;
esac

if [ -f "$STATE_FILE" ]; then exit 0; fi

reason="Refusing $tool on $(basename "$file_path") — invoke the cube-css skill first this session.

Stylesheets here are CUBE CSS over Every Layout primitives: which layer a rule belongs in, why utilities carry !important and blocks may not, the no-width-media-query mandate, and the review gates (a hardcoded value on first use, a z-index where source order would do, a minmax() with no min(…, 100%) guard). A folder README documents the house style — which rule landed where, and why — not the system underneath it, so having read one is not having loaded the other.

Fix: call the Skill tool with skill 'cube-css', then retry the edit. Reach for the utopia skill alongside it when the change touches a type size, a space step or a clamp().

If you have just done that and this still denies, your harness does not run PreToolUse on Skill calls: arm the session by creating $STATE_FILE and carry on — do not invoke the skill a third time. The same file is the opt-out where the target is genuinely not a CUBE stylesheet."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
