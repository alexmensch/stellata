# Harness guard hooks

Tool-call guards for Claude Code. The four `.sh` files are PreToolUse /
SessionStart hooks registered in `.claude/settings.json`; each reads the
hook payload as JSON on stdin and answers with a `permissionDecision`.

## Files in this area

```
scripts/hooks/
  readme-guard.sh          Blocks Read / Grep / Edit / Write /
                           NotebookEdit against files under src/**,
                           scripts/**, data/**, docs/** until the
                           containing folder's README.md has been seen
                           this session. Enforces AGENTS.md § Folder
                           READMEs (the scout pass) as a hard gate.
                           Behaviour pinned by tests/readme-guard.test.ts.
  prime-guard.sh           SessionStart: persists the full `bd prime`
                           output and emits a ~460-byte pointer to it.
                           PreToolUse: blocks every tool call until that
                           file is Read. Enforces ~/.claude/CLAUDE.md
                           § Session-start hook output. Behaviour pinned
                           by tests/prime-guard.test.ts.
  commit-sweep-guard.sh    Blocks `git commit` Bash calls when the
                           staged tree touches a guarded folder
                           without updating its README.md (AGENTS.md
                           § Folder READMEs trigger 4 — "At commit
                           time, update"), and/or when the staged
                           diff introduces forbidden code-comment
                           patterns (same set as
                           tests/code-comment-rules.test.ts).
                           Behaviour pinned by
                           tests/commit-sweep-guard.test.ts.
  perf-guard.sh            Two independent gates on Bash / Write / Edit /
                           NotebookEdit: any tool call that names the
                           `.perf-go` arm marker is denied outright, and a
                           perf-runner launch (`pnpm|npm|yarn|bun [run]
                           perf`, `tsx scripts/perf/run.ts`, …) is denied
                           while the repo root lacks a marker fresher than
                           an hour. Splitting them is what stops a launch
                           spelling the hook misses from carrying a
                           self-arm through with it. Fails CLOSED —
                           § How perf-guard fails closed. The deny reason
                           carries the arm protocol. Marker name and
                           freshness come from
                           scripts/perf/perf-go-lib.sh, shared with the
                           poller and (parsed) the runner;
                           scripts/perf/README.md § Human-armed owns the
                           design. Behaviour pinned by
                           tests/perf-guard.test.ts.
  comment-rules.json       The forbidden comment patterns, once. Read
                           by tests/code-comment-rules.test.ts and by
                           commit-sweep-guard.sh. The two hand-copied
                           sets that preceded it had already drifted
                           apart.
  comment-rules.ts         Typed reader for that file.
```

## How readme-guard works

State lives in
`${TMPDIR:-/tmp}/claude-readme-guard/seen-${GUARD_SESSION:-$PPID}.txt`.
Keying on `$PPID` (the parent Claude process) gives the seen-set
session lifetime: every tool call in one Claude session has the same
parent PID, a Claude restart starts a fresh PID, concurrent sessions
run under different parents and never collide. No SessionStart hook
needed — process lifetime is the natural scope.

`$GUARD_SESSION` overrides that key for a caller that spawns a fresh
shell per guard invocation, where `$PPID` would differ on every call
and the seen-set would never accumulate. Unset, behaviour is exactly
as before.

The hook walks up from the tool's `file_path` to the nearest
`README.md` inside the repo. If that README is in the session's
seen-set, the call passes through. If not, the hook returns a
`permissionDecision: "deny"` with a message naming the README to
read and quoting the rule.

The path is resolved with `pwd -P` before any of that, because
`git rev-parse --show-toplevel` reports a realpath: a checkout reached
through a symlink otherwise failed the guarded-prefix test and the
hook exited silent. macOS `/tmp` is one such symlink.

A `Read` of a `README.md` itself is always allowed and adds it to the
seen-set, so the reading flow ("Read the folder's README, then read
its files") works without intervention.

`Write` / `Edit` of a README mark it seen too — but only under a
harness that refuses to modify a file the session hasn't Read. There,
a call reaching the hook either authored that README this session or
read it earlier, so the authoring flow ("write the new folder's
README, then its files") also works. A caller without that
read-before-write rule sets `GUARD_NO_READ_BEFORE_WRITE=1` so only
`Read` marks; otherwise a write to a README the agent never opened
would disarm the gate for every file in that folder — the authoring
convenience becomes a hole precisely where the harness stops
guaranteeing the read.

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

## Why a hook and not just AGENTS.md text

AGENTS.md already mandates the scout pass in strong language. The
trouble is text-level rules rely on the model self-checking against
them, and self-checks lose to momentum on long debugging sessions
— exactly when the rule matters most. A PreToolUse hook is the
harness executing the rule, which Claude cannot bypass without
fixing it. Same shape as `~/.claude/hooks/worktree-guard.sh` (the
"every edit must be in a worktree" rule).

## How prime-guard works

`bd prime --hook-json` emits roughly 12KB of SessionStart context. The
host inlines a 2KB preview and persists the rest, so the memories sit
past the cutoff — a session that doesn't read the persisted file runs
on the header boilerplate alone. Shrinking the payload doesn't help:
the memories by themselves run to several KB, so even
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

### Why a gate and not just the prose rule

The user-level `~/.claude/CLAUDE.md` already mandates this read in
strong language, and it was still skipped in every session — the
notice arrives *after* the user's first message, buried in harness
boilerplate (deferred-tool names, agent types, skills), where it reads
as environment inventory rather than an instruction. bd's own line is
conditional ("**If** this output is truncated by your host…"), and the
host's truncation banner reads as plumbing metadata. Same conclusion
as readme-guard: the harness executing the rule beats the model
self-checking against it.

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
breakdown and the relevant AGENTS.md § Code comments substitution.

Scope caveat: `-a` / `--all` commits aren't fully inspected; only
already-staged files are checked. The standard `git add <files> &&
git commit` flow Claude uses is covered correctly.

## How perf-guard fails closed

The other guards here enforce hygiene; this one enforces **consent**, and
that inverts the failure posture. `prime-guard` fails open on purpose — a
session without memories beats a session that cannot call a tool. A consent
gate cannot: the harness treats a hook exiting non-zero as a malfunction and
lets the call through, so any error in perf-guard would silently permit an
unasked-for GPU run.

So every route out of the script other than an explicit pass is a denial. An
`ERR` trap denies with the failing line; a marker whose age cannot be read
denies rather than assuming it is fresh; a missing `jq` prints the reason to
stderr and exits **2**, the harness's other blocking spelling, instead of
dying mid-pipe. The `stat` portability trap that first exposed this — the
hook erroring, and therefore permitting, on every Linux checkout while the
macOS suite stayed green — is `scripts/perf/README.md` § Traps.

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
