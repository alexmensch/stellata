#!/usr/bin/env bash
# skill-guard: PreToolUse hook on Skill / Edit / Write / NotebookEdit. Blocks
# an edit to a file a rule below names until that rule's skill has been
# invoked this session. See README.md#how-skill-guard-works.
#
# State scope: keyed on $PPID the way readme-guard is, for the same
# reasons. $GUARD_SESSION overrides it for a harness that spawns a fresh
# shell per call.

set -euo pipefail

. "$(dirname "$0")/skill-name.sh"

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

case "$file_path" in
  *.css)
    skill=cube-css
    why="Stylesheets here are CUBE CSS over Every Layout primitives: which layer a rule belongs in, why utilities carry !important and blocks may not, the no-width-media-query mandate, and the review gates (a hardcoded value on first use, a z-index where source order would do, a minmax() with no min(…, 100%) guard). A folder README documents the house style — which rule landed where, and why — not the system underneath it, so having read one is not having loaded the other.

Reach for the utopia skill alongside it when the change touches a type size, a space step or a clamp()."
    opt_out=" The same file is the opt-out, for the rest of the session, where the target is genuinely not a CUBE stylesheet."
    ;;
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.py|*.sh|*.wgsl|*.glsl)
    skill=code-craft
    why="Every code change is design work, a one-line bug fix included: the design pass (one owner per fact, no legal-looking 'not ready' value, what each module hides, where the copies are), the two-hats commit split, and the recurring-bug-class rule. A folder README says what the code here does, not how to judge a change to it, so having read one is not having loaded the other."
    opt_out=""
    ;;
  *) exit 0 ;;
esac

state_file="$(marker "$skill")"
if [ -f "$state_file" ]; then exit 0; fi

reason="Refusing $tool on $(basename "$file_path") — invoke the $skill skill first this session.

$why

Fix: call the Skill tool with skill '$skill', then retry the edit.

If you have just done that and this still denies, your harness does not run PreToolUse on Skill calls: arm the session by creating $state_file and carry on — do not invoke the skill a third time.$opt_out"

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
