# Harness guard hooks

Tool-call guards for both harnesses this repo is worked in. The three
`.sh` files are PreToolUse / SessionStart hooks Claude Code fires,
registered in `.claude/settings.json`; `omp-bridge.ts` replays those
same scripts under omp, which reads none of that file. One
implementation, two harnesses, so their behaviour cannot drift.

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
  omp-bridge.ts            omp extension factory. Replays the three
                           guards above against omp's `tool_call`
                           event, and natively enforces the two rules
                           no .sh guard covers: writes belong in a
                           secondary worktree, and main/master takes
                           no commit or push. Behaviour pinned by
                           tests/omp-bridge.test.ts.
  omp-bridge-pure.ts       Path extraction and command classification
                           for the bridge — no I/O. Pinned by
                           tests/omp-bridge-pure.test.ts, with the
                           tool roster held against the installed omp
                           by tests/omp-tool-roster.test.ts.
```

`.omp/extensions/stellata-guards.ts` re-exports the bridge factory;
that is the whole of omp's wiring. See `.omp/README.md` for why the
entry point sits there rather than in `.omp/hooks/pre/`.

## How readme-guard works

State lives in
`${TMPDIR:-/tmp}/claude-readme-guard/seen-${GUARD_SESSION:-$PPID}.txt`.
Keying on `$PPID` (the parent Claude process) gives the seen-set
session lifetime: every tool call in one Claude session has the same
parent PID, a Claude restart starts a fresh PID, concurrent sessions
run under different parents and never collide. No SessionStart hook
needed — process lifetime is the natural scope.

`$GUARD_SESSION` overrides that key, and the omp bridge sets it,
because omp spawns a fresh shell per guard call — `$PPID` would differ
on every call and the seen-set would never accumulate. Unset,
behaviour is exactly as before.

The hook walks up from the tool's `file_path` to the nearest
`README.md` inside the repo. If that README is in the session's
seen-set, the call passes through. If not, the hook returns a
`permissionDecision: "deny"` with a message naming the README to
read and quoting the rule.

A `Read` of a `README.md` itself is always allowed and adds it to the
seen-set, so the reading flow ("Read the folder's README, then read
its files") works without intervention.

`Write` / `Edit` of a README mark it seen too — but only under a
harness that refuses to modify a file the session hasn't Read. There,
a call reaching the hook either authored that README this session or
read it earlier, so the authoring flow ("write the new folder's
README, then its files") also works. omp has no read-before-write
rule, so the bridge sets `GUARD_NO_READ_BEFORE_WRITE=1` and only
`Read` marks. Without that split, a write to a README the agent never
opened would disarm the gate for every file in that folder — the
authoring convenience becomes a hole precisely where the harness stops
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

## How the omp bridge works

omp does not read the `hooks` block in `.claude/settings.json` — it
loads that file as *settings*, and Claude's hook schema is not part of
its own. Without the bridge, all four guards (including the user-level
worktree guard) are inert under omp.

`omp-bridge.ts` registers two handlers:

- **`tool_call`** — translates the call into the PreToolUse stdin
  payload the `.sh` guards already parse, and translates a
  `permissionDecision: "deny"` back into `{ block: true, reason }`.
  omp fails a throwing `tool_call` handler closed, so a guard that
  cannot even be spawned blocks rather than passing.
- **`session_compact`** — re-arms the prime gate (below).

### Path extraction is the load-bearing part

A tool whose paths the bridge cannot resolve is silently ungated
rather than loudly broken, so `toolTargets` is inverted: **a tool
absent from `KNOWN_TOOLS` blocks**, and so does a known tool that must
name a file and doesn't. Growing `KNOWN_TOOLS` is a deliberate edit,
and `tests/omp-tool-roster.test.ts` fails when the installed omp grows
a tool the map has not triaged. `STELLATA_OMP_ALLOW_UNKNOWN_TOOLS=1`
unblocks a session while that edit is being made.

Per-tool notes that are not obvious from the schemas:

- `edit` carries its paths as `[path#TAG]` hashline headers plus any
  `MV DEST` destination. Under `edit.mode: replace`/`patch` there are
  no headers, so a direct `path`/`file` is used instead.
- `apply_patch` is the same internal tool under a different wire name
  (`edit.mode: apply_patch`) and gates identically. It appears in no
  `--tools` roster, which is why the roster test pins it by name.
- `ast_edit` and `lsp` also arrive as a `write` to `xd://<tool>` whose
  `content` is that tool's own JSON arguments; the extractor recurses
  and reports the device as the effective tool.
- `lsp` mutates for `rename`, `rename_file`, `code_actions` and
  `request` — omp's own write-approval set. `request` is included
  because a raw LSP method can return a `workspace/applyEdit` the
  client applies. `rename_file` gates `new_name` as well as `file`:
  the destination can land in a folder no other argument names.
- `grep` splits several roots out of one `;`-delimited string; a
  `read` path containing `;` stays literal.
- A wildcard read is a listing and gates nothing; a wildcard rewrite
  is charged to the deepest folder it descends into.

### The trunk rule is a handler, not a `bash.patterns` glob

Whether a push is allowed depends on where HEAD is, not on the text of
the command, so no pattern over command text can express it. Four
directories can decide, and the bridge resolves them in this order:
`git -C <path>`, a leading `cd <path> &&` (omp rewrites that into the
structured `cwd` field, but only *after* this hook has run), the bash
tool's own `cwd` argument, then the session cwd.

A repo whose HEAD names no branch blocks. `git symbolic-ref` returns
nothing on a detached HEAD, which reads as "unknown", not "not main".
A path in no repository at all is allowed — there is no branch to
protect.

`github` op `pr_push` bypasses the bash tool entirely, so it is gated
separately, on the `branch` argument and on the `ompPrHeadRef` that
`pr_checkout` recorded in branch config — the remote ref the push
actually writes.

### The prime gate does not depend on a session event

Under Claude Code, SessionStart persists `bd prime --full` and re-arms
on compact and resume. Under omp, `session_start` **does not fire on a
resumed session**, so arming from it would leave a resumed session
ungated. The bridge instead arms lazily from `tool_call`, which always
fires: the first call of a session runs prime-guard's SessionStart
branch, then its PreToolUse branch. The deny message names the file to
read, so no separate notification is needed.

`session_compact` re-arms it, because compaction is what summarises
the prime text away. Injecting the text back was considered and
rejected: `session.compacting`'s `context` return only feeds the
summarisation prompt, and `preserveData` is stored on the compaction
entry rather than re-entering the context, so neither guarantees the
content survives. Re-arming the gate does.

## What the omp bridge cannot reach

Documented rather than pretended away.

- **`bash` writing through a route the classifier misses.**
  `bashWriteTargets` covers `sed -i`, `perl -i`, `awk -i inplace`,
  `tee`, and `>`/`>>` redirection — every form that names its target
  as a literal argument. A write reached through command substitution,
  a heredoc, a script file, `cp`/`mv`, or a compiled program is not
  seen. omp's `bashInterceptor` covers some of the same commands but
  is explicitly best-effort routing rather than a security boundary —
  a rule goes inert when its target tool is disabled — so it is not
  used here.
- **`eval` and `debug`** can open a file with no static argument
  naming it, and `eval` can spawn a shell.
- **`task` subagents** run as separate processes, and a subagent
  spawned with restricted tools loads no extensions at all. Treat
  delegated work as possibly ungated.
- **`browser` and `computer`** drive software that can write files.
- **`hub`** can start a long-running process.

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
   temporarily move the hook script aside. Under omp the whole bridge
   goes away with
   `disabledExtensions: [extension-module:stellata-guards]`, or
   `--no-extensions` for one run.

Disabling is the right call when investigating a folder that
genuinely has no subsystem ownership (e.g. ad-hoc scratch) — but the
default answer is to read or update the README.
