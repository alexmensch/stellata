# Claude Code hooks

PreToolUse / SessionStart shell hooks the harness fires around tool
calls. Registered in `.claude/settings.json` at the repo root; this
folder holds the hook bodies so the registration stays a one-line
path reference.

## Files in this area

```
scripts/hooks/
  readme-guard.sh    Blocks Read / Grep / Edit / Write / NotebookEdit
                     against files under src/**, scripts/**, data/**,
                     docs/** until the containing folder's README.md
                     has been Read this session. Enforces CLAUDE.md
                     § Folder READMEs (the scout pass) as a hard
                     gate, not just a written rule.
```

## How readme-guard works

State lives in `${TMPDIR:-/tmp}/claude-readme-guard/seen-$PPID.txt`.
Keying on `$PPID` (the parent Claude process) gives the seen-set
session lifetime: every tool call in one Claude session has the same
parent PID, a Claude restart starts a fresh PID, concurrent sessions
run under different parents and never collide. No SessionStart hook
needed — process lifetime is the natural scope.

The hook walks up from the tool's `file_path` to the nearest
`README.md` inside the repo. If that README is in the session's
seen-set, the call passes through. If not, the hook returns a
`permissionDecision: "deny"` with a message naming the README to
read and quoting the rule.

Read of a `README.md` itself is always allowed and adds the README
to the seen-set — so the natural flow ("Read the folder's README,
then read its files") works without intervention.

Grep over a *directory* (the broad-search case) is allowed; Grep
into a single file is gated like Read. Glob isn't gated at all
(it lists paths, doesn't read content).

## Why a hook and not just CLAUDE.md text

CLAUDE.md already mandates the scout pass in strong language. The
trouble is text-level rules rely on the model self-checking against
them, and self-checks lose to momentum on long debugging sessions
— exactly when the rule matters most. A PreToolUse hook is the
harness executing the rule, which Claude cannot bypass without
fixing it. Same shape as `~/.claude/hooks/worktree-guard.sh` (the
"every edit must be in a worktree" rule).

## Disabling

Two paths:

1. **One call only.** Clear the seen-state file for the current
   session: `rm ${TMPDIR:-/tmp}/claude-readme-guard/seen-$PPID.txt`.
   The next call will deny again until a README is Read.
2. **Across the session.** Remove the entry from
   `.claude/settings.json`'s `hooks.PreToolUse` array, or
   temporarily move `scripts/hooks/readme-guard.sh` aside.

Disabling is the right call when investigating a folder that
genuinely has no subsystem ownership (e.g. ad-hoc scratch under
`scripts/refresh/`) — but the default answer is to Read the README.
