#!/usr/bin/env bash
# readme-guard: PreToolUse hook on Read / Grep / Edit / Write /
# NotebookEdit. Blocks code-file access in src/**, scripts/**, data/**,
# docs/** until the containing folder's README.md has been Read this
# session. Forces the "scout pass" AGENTS.md § Folder READMEs mandates.
#
# State scope: keyed on $PPID (the long-lived Claude process), so all
# tool calls in one session share the seen-set and a Claude restart
# starts fresh. Concurrent Claude sessions run in different worktrees
# per project policy, each with their own parent process, hence their
# own seen-set.

set -euo pipefail

STATE_DIR="${TMPDIR:-/tmp}/claude-readme-guard"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/seen-$PPID.txt"

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
file_path="$(printf '%s' "$input" | jq -r '
  .tool_input.file_path
  // .tool_input.notebook_path
  // .tool_input.path
  // ""
')"

if [ -z "$file_path" ]; then
  exit 0
fi

case "$file_path" in
  /*) abs="$file_path" ;;
  *)  abs="$(pwd)/$file_path" ;;
esac

# Walk up to find an existing ancestor so `git -C` works for new files.
probe="$abs"
while [ -n "$probe" ] && [ ! -e "$probe" ]; do
  parent="$(dirname "$probe")"
  if [ "$parent" = "$probe" ]; then probe=""; break; fi
  probe="$parent"
done
if [ -z "$probe" ]; then exit 0; fi
if [ ! -d "$probe" ]; then probe="$(dirname "$probe")"; fi

toplevel="$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$toplevel" ]; then exit 0; fi

# Files outside the guarded prefixes — let them through.
case "$abs" in
  "$toplevel"/src/*|"$toplevel"/scripts/*|"$toplevel"/data/*|"$toplevel"/docs/*) ;;
  *) exit 0 ;;
esac

# Reading a README.md marks its folder as seen and is always allowed.
# Write / Edit mark it too: the harness refuses to overwrite or edit a
# file the session hasn't Read, so a call reaching here either authored
# the README this session or already read it.
basename="$(basename "$abs")"
if [ "$basename" = "README.md" ]; then
  case "$tool" in
    Read|Write|Edit)
      printf '%s\n' "$abs" >> "$STATE_FILE"
      exit 0
      ;;
  esac
fi

# Grep over a directory is a broad search — gating it would block
# cross-folder symbol lookups before any folder is even implicated.
# Only gate Grep when its target resolves to a single file.
if [ "$tool" = "Grep" ] && [ -d "$abs" ]; then
  exit 0
fi

dir="$(dirname "$abs")"

# A folder whose README has never existed — none on disk, nothing tracked
# in git — is one this session is creating, so there is no prior context to
# scout. folder-readme-coverage.test.ts owns requiring the README exists;
# commit-sweep-guard owns the commit-time update.
if [ ! -f "$dir/README.md" ] &&
   [ -z "$(git -C "$toplevel" ls-files -- "$dir" 2>/dev/null || true)" ]; then
  exit 0
fi

# Find the closest README.md by walking up from the file's directory.
readme=""
while [ "$dir" != "$toplevel" ] && [ "$dir" != "/" ] && [ -n "$dir" ]; do
  if [ -f "$dir/README.md" ]; then
    readme="$dir/README.md"
    break
  fi
  parent="$(dirname "$dir")"
  if [ "$parent" = "$dir" ]; then break; fi
  dir="$parent"
done

# No README in the chain — the folder-readme-coverage CI test owns
# enforcing that's a bug. Let the call through here.
if [ -z "$readme" ]; then exit 0; fi

# Already read this session? Allow.
if [ -f "$STATE_FILE" ] && grep -qxF "$readme" "$STATE_FILE"; then
  exit 0
fi

rel_readme="${readme#"$toplevel"/}"
rel_file="${abs#"$toplevel"/}"
reason="Refusing $tool on $rel_file — Read $rel_readme first this session.

AGENTS.md § Folder READMEs makes the scout pass law: every folder under src/, scripts/, data/, docs/ carries load-bearing context (invariants, sentinels, uniform pins, override mechanisms, file-roster ownership) that the code alone cannot tell you. The README sentence describing a shader uniform / sentinel / override is frequently the entire explanation of a bug whose symptom looks unrelated.

Fix: Read $rel_readme, then retry. If you're about to touch several folders, batch the README reads up front — the per-file impulse is exactly when the read gets skipped.

If this rule is genuinely in the way (e.g. the file truly doesn't belong to any subsystem), disable the hook for this call by clearing $STATE_FILE — but the default answer is 'read the README'."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
