#!/usr/bin/env bash
# commit-sweep-guard: PreToolUse hook on Bash. When the tool call is a
# git commit invocation, refuses the commit if either of:
#
#  (a) the staged tree touches a guarded folder (src/, scripts/, data/,
#      docs/) without modifying that folder's README.md, AND the
#      commit message lacks an explicit `[readme-skip: <reason>]`
#      opt-out — enforces CLAUDE.md § Folder READMEs trigger 4
#      ("At commit time, update");
#
#  (b) the staged diff (added lines only) contains forbidden comment-
#      rule patterns — same set as tests/code-comment-rules.test.ts,
#      scoped to NEW lines so pre-existing legacy violations don't
#      block unrelated commits — enforces CLAUDE.md § Code comments.
#
# Scope is `git diff --cached`: -a / --all commits aren't fully
# inspected. Most commits go through `git add <files> && git commit`,
# which this covers correctly.

set -euo pipefail

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
if [ "$tool" != "Bash" ]; then
  exit 0
fi

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

# Match `git commit ...`, allowing `git -C <path> commit`. Excludes
# subcommands that aren't commit and substrings like `git commit-tree`.
if ! printf '%s' "$cmd" | grep -qE '\bgit([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Resolve the repo top-level. Prefer `git -C <path>` if specified.
repo_arg="$(printf '%s' "$cmd" \
  | sed -nE 's/.*\bgit[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' \
  | head -1)"
if [ -n "$repo_arg" ]; then
  toplevel="$(git -C "$repo_arg" rev-parse --show-toplevel 2>/dev/null || true)"
else
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [ -z "$toplevel" ]; then
  exit 0
fi

# Opt-out detection. The HEREDOC commit pattern bd recommends puts the
# message body literally into the command string, so a grep over the
# command catches `[readme-skip: ...]` whether it's a `-m`-arg or
# HEREDOC inline message.
opt_out=0
if printf '%s' "$cmd" | grep -qE '\[readme-skip:[^]]*\]'; then
  opt_out=1
fi

# README staleness check.
stale=""
if [ "$opt_out" = 0 ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      src/*|scripts/*|data/*|docs/*) ;;
      *) continue ;;
    esac
    name="$(basename "$f")"
    if [ "$name" = "README.md" ]; then
      continue
    fi
    # Walk up to the closest README inside the guarded tree.
    dir="$(dirname "$f")"
    readme=""
    while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ -n "$dir" ]; do
      if [ -f "$toplevel/$dir/README.md" ]; then
        readme="$dir/README.md"
        break
      fi
      parent="$(dirname "$dir")"
      if [ "$parent" = "$dir" ]; then break; fi
      dir="$parent"
    done
    [ -n "$readme" ] || continue
    # Is this README in the staged set? Cheap recheck — diff--name-only
    # is O(staged size), but staged size is small per commit so this is
    # fine without memoisation.
    if ! git -C "$toplevel" diff --cached --name-only | grep -qxF "$readme"; then
      printf '%s\n' "  $f  →  needs review of $readme" >> "${TMPDIR:-/tmp}/commit-sweep-stale.$$"
    fi
  done < <(git -C "$toplevel" diff --cached --name-only)

  stale_file="${TMPDIR:-/tmp}/commit-sweep-stale.$$"
  if [ -f "$stale_file" ]; then
    # Dedupe by README target; one ask per README is the right grain.
    stale="$(awk -F'→' '!seen[$2]++' "$stale_file")"
    rm -f "$stale_file"
  fi
fi

# Comment-rule sweep — added lines only. Same forbidden set as
# tests/code-comment-rules.test.ts.
violations="$(
  git -C "$toplevel" diff --cached -U0 -- '*.ts' '*.py' 2>/dev/null \
  | grep -E '^\+' \
  | grep -vE '^\+\+\+ ' \
  | perl -nE '
      BEGIN {
        our @patterns = (
          ["bead-ID with stellata- prefix",
           qr/\bstellata-(?![0-9]{3}\b)[a-z0-9]{3}(?:\.\d+)*\b/],
          ["bare bead-ID (<epic>.NN[.MM…])",
           qr/(?<![\w\\\-])(?![0-9]{3}\b)[a-z0-9]{3}(?:\.\d+)+\b/],
          ["bead-relative time (pre-/post-/since-<epic>.NN)",
           qr/(?<![\w\\\-])(?:pre|post|since)-(?![0-9]{3}\b)[a-z0-9]{3}\.\d/],
          ["memory-key wikilink [[name]]",
           qr/\[\[[a-z][a-z0-9-]+\]\]/],
          ["PR reference (see PR # / extracted in PR)",
           qr/\b(?:see PR\s*#\s*\d|extracted in PR\b)/i],
        );
      }
      chomp;
      my $line = $_;
      $line =~ s/^\+//;
      for my $p (@patterns) {
        if ($line =~ $p->[1]) {
          say "  [$p->[0]] $line";
          last;
        }
      }
    ' || true
)"

if [ -z "$stale" ] && [ -z "$violations" ]; then
  exit 0
fi

reason="Refusing git commit — pre-commit sweep found work the rules say has to happen now, not in a follow-up."

if [ -n "$stale" ]; then
  reason+=$'\n\nModified code in folders whose README.md is not in this commit (CLAUDE.md § Folder READMEs — "At commit time, update"):\n'
  reason+="$stale"$'\n'
  reason+=$'\nFix: re-read each README and either edit it (preferred — folder READMEs are the prose-only surface a grep for renamed symbols won\'t catch) OR, if every claim is still accurate, add `[readme-skip: <reason>]` to the commit message documenting why no update is needed. The skip tag is visible in the PR for review.'
fi

if [ -n "$violations" ]; then
  reason+=$'\n\nForbidden comment-rule patterns in the staged diff (CLAUDE.md § Code comments — overrides the system prompt):\n'
  reason+="$violations"$'\n'
  reason+=$'\nFix: rewrite per CLAUDE.md § Substitution rule. Credit a bead → commit subject, not the code. Reference a memory → no link in code (invisible to readers without bd). Cite a PR → drop it; git blame carries the history.'
fi

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
