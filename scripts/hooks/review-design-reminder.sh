#!/usr/bin/env bash
# review-design-reminder: UserPromptSubmit + PreToolUse(Skill) hook. Once a
# pr-review starts in a session, every later prompt carries a one-line
# reminder to apply code-craft's design pass. See README.md#how-review-design-reminder-works.

set -uo pipefail

. "$(dirname "$0")/skill-name.sh"

REMINDER='PR review in progress: before proposing any change this turn (fix, test, guard, doc, alternative), apply code-craft § Design pass and state *owner* and *enforced by* for it. Load code-craft first if it is no longer in context.'

input="$(cat)"
session="$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null)"
[ -n "$session" ] || exit 0

STATE_DIR="${TMPDIR:-/tmp}/claude-review-design-reminder"
mkdir -p "$STATE_DIR" || exit 0
MARKER="$STATE_DIR/active-$session"

event="$(printf '%s' "$input" | jq -r '.hook_event_name // ""')"

case "$event" in
  PreToolUse)
    skill="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""')"
    if is_skill "$skill" pr-review; then : > "$MARKER"; fi
    ;;
  UserPromptSubmit)
    prompt="$(printf '%s' "$input" | jq -r '.prompt // ""')"
    command="${prompt#"${prompt%%[![:space:]]*}"}"
    command="${command%%[[:space:]]*}"
    if [ "${command:0:1}" = / ] && is_skill "${command#/}" pr-review; then
      : > "$MARKER"
    fi
    if [ -f "$MARKER" ]; then
      jq -n --arg ctx "$REMINDER" \
        '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
    fi
    ;;
esac
exit 0
