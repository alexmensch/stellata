# Claude Code hooks

PreToolUse / SessionStart shell hooks the harness fires around tool
calls. Registered in `.claude/settings.json` at the repo root; this
folder holds the hook bodies so the registration stays a one-line
path reference.

## Files in this area

```
scripts/hooks/
  readme-guard.sh          Blocks Read / Grep / Edit / Write /
                           NotebookEdit against files under src/**,
                           scripts/**, data/**, docs/** until the
                           containing folder's README.md has been seen
                           this session. Enforces CLAUDE.md § Folder
                           READMEs (the scout pass) as a hard gate.
                           Behaviour pinned by tests/readme-guard.test.ts.
  prime-guard.sh           SessionStart: persists the full `bd prime`
                           output and emits a ~460-byte pointer to it.
                           PreToolUse: blocks every tool call until
                           that file is Read. Enforces CLAUDE.md
                           § Session-start hook output. Behaviour
                           pinned by tests/prime-guard.test.ts.
  commit-sweep-guard.sh    Blocks `git commit` Bash calls when the
                           staged tree touches a guarded folder
                           without updating its README.md (CLAUDE.md
                           § Folder READMEs trigger 4 — "At commit
                           time, update"), and/or when the staged
                           diff introduces forbidden code-comment
                           patterns (same set as
                           tests/code-comment-rules.test.ts).
                           Behaviour pinned by
                           tests/commit-sweep-guard.test.ts.
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

A `Read` / `Write` / `Edit` of a `README.md` itself is always allowed
and adds it to the seen-set — so both the reading flow ("Read the
folder's README, then read its files") and the authoring flow ("write
the new folder's README, then its files") work without intervention.
`Write` / `Edit` count as seen because the harness already refuses to
overwrite or edit a file the session hasn't Read: a call reaching the
hook either authored that README or read it earlier.

A folder whose README has **never** existed — none on disk *and*
nothing tracked in git under it — is exempt: the session is creating
it, so there is no prior context to scout, and charging the *parent*
folder's README for a new subsystem's first file was a false positive.
Both conditions are required, so an untracked folder that already
carries a README (one an earlier session left behind) is still gated,
and a committed folder missing a README is still charged to its
nearest ancestor. Requiring the README to exist at all stays with
`tests/folder-readme-coverage.test.ts`; the commit-time update stays
with `commit-sweep-guard`.

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

## How prime-guard works

`bd prime --hook-json` emits ~24KB of SessionStart context. The host
inlines a 2KB preview and persists the rest, so the 17 memories sit
past the cutoff — a session that doesn't read the persisted file runs
on roughly the first third of the memory list. Shrinking the payload
doesn't help: the memories alone are 19.6KB, so even
`bd prime --memories-only` truncates.

prime-guard replaces `bd prime --hook-json` in the SessionStart slot
and does two jobs, branching on `hook_event_name`:

1. **SessionStart.** Runs `bd prime --full`, writes it to
   `$STATE_DIR/prime-<session>.md`, drops an `unread-<session>`
   sentinel, and emits ~460 bytes of `additionalContext` — one
   unconditional imperative naming the absolute path, with the memory
   count scraped from the output so the notice states what's being
   missed. Small enough that no host truncates it, so the surviving
   text is *only* the instruction.
2. **PreToolUse** (matcher `*`). While the sentinel exists, every call
   is denied except a `Read` whose `file_path` is exactly the prime
   file. That Read removes the sentinel; everything after it passes.

State is keyed on the payload's `session_id`, not `$PPID` the way
readme-guard is: readme-guard's PPID scoping works because every
PreToolUse call shares the parent process, but the SessionStart hook
isn't guaranteed to run under that same parent.

**Fails open.** A `bd prime` that errors or returns nothing leaves no
sentinel and emits no context — a session with no memories beats a
session that can't call a tool. `PRIME_GUARD_BD` overrides the binary
(the test seam).

Re-arming is deliberate: SessionStart fires on compact and resume too,
and those are exactly the moments the context was just lost.

### Why a gate and not just the CLAUDE.md rule

The global CLAUDE.md already mandates this read in strong language,
and it was still skipped in every session — the notice arrives *after*
the user's first message, buried in harness boilerplate (deferred-tool
names, agent types, skills), where it reads as environment inventory
rather than an instruction. bd's own line is conditional ("**If** this
output is truncated by your host…"), and the host's truncation banner
reads as plumbing metadata. Same conclusion as readme-guard: the
harness executing the rule beats the model self-checking against it.

## How commit-sweep-guard works

`PreToolUse` on `Bash`. Filters down to `git commit ...` invocations
(handles `git -C <path> commit` and rejects subcommands like
`git commit-tree`); other Bash calls pass straight through. For a
matched commit:

1. **README staleness.** Walks the `git diff --cached --name-only`
   set. For each modified non-README under `src/`, `scripts/`,
   `data/`, `docs/`, finds the closest folder containing a
   `README.md` and reports if that README is missing from the staged
   set. Suppressed when the commit command string contains
   `[readme-skip: <reason>]` — works for both `-m "msg [readme-skip:
   …]"` and HEREDOC-style messages, since both put the literal text
   in the command. The skip-tag scan flattens newlines to spaces
   before matching so a multi-line reason inside the brackets still
   counts — without that, a HEREDOC message that wraps the bracketed
   reason was silently ignored (`[^]]*` doesn't span newlines under
   line-mode `grep -E`).

   **`-F` / `--file` / `--body-file` message files are read too**, and
   have to be: the command string then carries only a path, so a tag
   inside the file is invisible to a grep over the command. That is
   the *only* route a worktree-isolated session has for a long message
   — the worktree guard rejects `$( )` substitution and heredoc commit
   bodies — so without this the opt-out was unusable precisely where
   it was needed. A named file that is missing or unreadable is
   skipped rather than fatal, and only the first 64KB is scanned.

2. **Comment-rule sweep.** Runs `git diff --cached -U0` filtered to
   added lines (`^\+`, excluding `+++` headers) against the same
   forbidden-pattern set `tests/code-comment-rules.test.ts` uses —
   bead-IDs, bead-relative time refs, memory wikilinks, PR
   references. Scoped to NEW content so pre-existing legacy
   violations don't block unrelated commits.

Either check fires a `permissionDecision: "deny"` with a per-finding
breakdown and the relevant CLAUDE.md substitution rule.

Scope caveat: `-a` / `--all` commits aren't fully inspected; only
already-staged files are checked. The standard `git add <files> &&
git commit` flow Claude uses is covered correctly.

## Disabling

Two paths:

1. **One call only.** For `readme-guard`: clear the seen-state file
   (`rm ${TMPDIR:-/tmp}/claude-readme-guard/seen-$PPID.txt`).
   For `commit-sweep-guard`: pass `[readme-skip: <reason>]` in the
   commit message (covers the README check; comment violations still
   block — fix the comments). For `prime-guard`: delete the sentinel
   — any tool call naming that path is allowed through precisely so
   the `rm` isn't itself blocked.
2. **Across the session.** Remove the entry from
   `.claude/settings.json`'s `hooks.PreToolUse` array, or
   temporarily move the hook script aside.

Disabling is the right call when investigating a folder that
genuinely has no subsystem ownership (e.g. ad-hoc scratch) — but the
default answer is to read or update the README.
