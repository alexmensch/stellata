#!/usr/bin/env bash
# prime-guard: SessionStart persists the full `bd prime` output and emits a
# short pointer to it; PreToolUse then blocks every tool call until that file
# has been Read. Enforces ~/.claude/CLAUDE.md § Session-start hook output.

set -euo pipefail

TMP_ROOT="${TMPDIR:-/tmp}"
STATE_DIR="${TMP_ROOT%/}/claude-prime-guard"
BD_BIN="${PRIME_GUARD_BD:-bd}"

input="$(cat)"
event="$(printf '%s' "$input" | jq -r '.hook_event_name // ""')"
session="$(printf '%s' "$input" | jq -r '.session_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"

if [ -z "$session" ]; then session="ppid-$PPID"; fi
session="$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')"

mkdir -p "$STATE_DIR"
PRIME_FILE="$STATE_DIR/prime-$session.md"
SENTINEL="$STATE_DIR/unread-$session"

case "$event" in
  SessionStart)
    if [ -n "$cwd" ] && [ -d "$cwd" ]; then
      set -- -C "$cwd"
    else
      set --
    fi

    # Fail open: no context beats a session that cannot call a single tool.
    if ! "$BD_BIN" "$@" prime --full >"$PRIME_FILE.part" 2>/dev/null ||
      [ ! -s "$PRIME_FILE.part" ]; then
      rm -f "$PRIME_FILE.part" "$SENTINEL"
      exit 0
    fi
    mv "$PRIME_FILE.part" "$PRIME_FILE"
    : >"$SENTINEL"

    count="$(sed -n 's/.*Persistent Memories (\([0-9]*\)).*/\1/p' "$PRIME_FILE" | head -1)"
    if [ -n "$count" ]; then
      subject="$count persistent project memories"
    else
      subject="the persistent project memories"
    fi

    context="MANDATORY, before replying to the user and before any other tool call:

    Read $PRIME_FILE

That file is this session's complete \`bd prime\` output — $subject, the bd
workflow rules, and the session-close protocol. It is too large to inline, so
this notice is all you get. It is a pointer, not a summary.

Every other tool call is blocked until that Read lands."

    jq -n --arg context "$context" '{
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: $context
      }
    }'
    ;;

  PreToolUse)
    if [ ! -f "$SENTINEL" ]; then exit 0; fi

    tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
    file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"

    if [ "$tool" = "Read" ] && [ "$file_path" = "$PRIME_FILE" ]; then
      rm -f "$SENTINEL"
      exit 0
    fi

    # Escape hatch: any call naming the sentinel is the operator clearing it.
    if printf '%s' "$input" | jq -r '.tool_input | tostring' | grep -qF "$SENTINEL"; then
      exit 0
    fi

    reason="Refusing $tool — this session has not read its bd prime context yet.

    Read $PRIME_FILE

The SessionStart hook output is far larger than the host inlines, so the
persistent project memories and workflow rules are not in your context. They
are in that file. Reading it is one call, and it is the whole of the fix.

~/.claude/CLAUDE.md § Session-start hook output makes this law; the gate exists because
the prose rule loses to momentum on the first turn, every time.

Genuinely need to bypass: delete $SENTINEL."

    jq -n --arg reason "$reason" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
    ;;
esac
