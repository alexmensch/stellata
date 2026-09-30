# Harness hooks

Harness hooks for Claude Code, registered in `.claude/settings.json`. Claude
Code's settings file watcher applies a registration change mid-session, so a
session that adds or edits a hook here is governed by it from the next call.
Each hook reads its payload as JSON on stdin. The six guards are PreToolUse /
SessionStart hooks answering with a `permissionDecision`; paper-store-link
answers nothing and acts only on the filesystem. The review
design-pass reminder lives at user level, in the code-standards bundle
(`~/.claude/hooks/code-standards/`).

## Files in this area

```
scripts/hooks/
  readme-guard.sh          Blocks Read / Grep / Edit / Write /
                           NotebookEdit against files under src/**,
                           scripts/**, data/**, docs/** until the
                           containing folder's README.md has been seen
                           this session. Enforces /AGENTS.md#folder-readmes--read-before-you-touch-the-folder-update-at-commit
                           (the scout pass) as a hard gate.
                           Behaviour pinned by tests/readme-guard.test.ts.
  prime-guard.sh           SessionStart: persists the full `bd prime`
                           output and emits a ~460-byte pointer to it.
                           PreToolUse: blocks every tool call until that
                           file is Read. Enforces ~/.claude/CLAUDE.md's
                           "Session-start hook output". Behaviour pinned
                           by tests/prime-guard.test.ts.
  commit-sweep/            The commit-time guard: README staleness,
                           forbidden comment patterns, the
                           restatement and snapshot-copy sweeps, plus
                           the comment-rule set the vitest scanner
                           shares. Own README.
  pr-body-guard.sh         Blocks `gh pr create|edit --body-file <f>`
                           when <f> would fail release-notes-guard or
                           perf-section-guard in CI, and `gh pr ready`
                           when the draft's body would, quoting the CI
                           error — README.md#how-pr-body-guard-works.
                           Behaviour pinned by
                           tests/pr-body-guard.test.ts.
  perf-guard.sh            Two independent gates on Bash / Write / Edit /
                           NotebookEdit: any tool call that names the
                           `.perf-go` arm marker is denied outright, and a
                           perf-runner launch (`pnpm|npm|yarn|bun [run]
                           perf`, `tsx scripts/perf/run.ts`, …) is denied
                           while the repo root lacks a marker fresher than
                           an hour. Splitting them is what stops a launch
                           spelling the hook misses from carrying a
                           self-arm through with it. Fails CLOSED —
                           README.md#how-perf-guard-fails-closed. The deny reason
                           carries the arm protocol. Marker name and
                           freshness come from
                           scripts/perf/arming/perf-go-lib.sh, shared with the
                           poller and (parsed) the runner;
                           scripts/perf/arming/README.md owns the
                           design. Behaviour pinned by
                           tests/perf-guard.test.ts.
  skill-guard.sh           Blocks Write / Edit / NotebookEdit against a
                           file a rule names until that rule's skill has
                           been invoked this session; a Skill call naming
                           it arms the session. Rules: *.css → cube-css,
                           Read / Grep gated too; code
                           (ts/tsx/js/mjs/cjs/py/sh/wgsl/glsl) →
                           code-craft.
                           Behaviour pinned by tests/skill-guard.test.ts.
  paper-store-link.sh      SessionStart + PostToolUse on EnterWorktree:
                           links data/papers/pdf in every linked
                           worktree that lacks it to the main
                           checkout's store —
                           README.md#how-paper-store-link-works.
                           Behaviour pinned by
                           tests/paper-store-link.test.ts.
  command-match.sh         CMD_START and ENV_PREFIX, the regex pieces that
                           find a command's start inside a Bash call and
                           skip `env` / `NAME=value` in front of it. Sourced
                           by perf-guard.sh and pr-body-guard.sh.
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

## How skill-guard works

Same shape as readme-guard, keyed on a skill instead of a folder. The rule
table is one `case` on the edited path; each arm names the skill and what it
carries (quoted in the denial), so a new gate is one arm. State is one
marker per skill at
`${TMPDIR:-/tmp}/claude-skill-guard/<skill>-${GUARD_SESSION:-$PPID}`, so a
session arms once per skill and edits freely after.

The hook sits on `Skill` as well as the edit tools, and that is the whole
mechanism: every `Skill` call touches the marker for the name it invokes —
the part after any directory-scoped or plugin prefix — and passes through.
Only then does an edit a rule claims find its skill's marker and go ahead;
without it the call is denied with the skill named. Arming every invoked
name rather than only the guarded ones keeps the rule table the single list
of which skills gate anything.

**cube-css gates the read, not only the edit.** Reading a stylesheet is
where planning starts, and a session that reads one, designs its change and
only then meets the gate at the edit has already designed without the
skill. A Grep into a single `.css` file is a read; a Grep over a directory
carries no `.css` path, so no rule claims it. code-craft gates edits only:
reading code is how every investigation starts, most of which change
nothing.

The gate exists because the load looks redundant from inside the repo and
is not. [House style](/src/site/styles/README.md#house-style) documents the **house
style** — which layer each rule landed in here, and why — while the system
underneath it (the layout primitives, the no-width-query mandate, the
review gates) belongs to the skill, and a README describing the one reads
convincingly like coverage of the other. A session that has read the
README therefore believes it is already briefed.

**code-craft has a second trap: the change does not look like design.**
Its trigger names design, refactor and review, and a bug fix reads as none
of them, so a bug-sweep session can scout, plan and draft a fix without
the design pass. Gating at the first code edit is the last point the load
can still shape the change. It does not reach a plan written before any
edit, so the prose trigger still owns that.

**Arming, not consent**, so it fails open the way readme-guard does: a
hook that errors lets the call through, and the alternative — a stylesheet
edit blocked by a broken gate — is worse than one made without the skill.
The deny message names the marker path, so a session that genuinely needs
to proceed creates it. Only cube-css offers that as an opt-out, for a
stylesheet that is not CUBE; code-craft offers none, since "this change is
too small for the design pass" is the excuse its gate exists to refuse.

That path is also the answer to the one thing the test suite cannot
settle, since it drives the script directly rather than through a harness:
whether a given harness runs `PreToolUse` on `Skill` calls at all. Where
one does not, the skill can be invoked and the marker still never appears,
so the deny message says to create it and stop invoking — a loop being the
failure mode a gate armed by another tool call invites.

## How pr-body-guard works

`PreToolUse` on `Bash`. The two body guards judge only the PR body and the
branch's diff, so both can run before the body leaves the machine — and
without this, a missing section surfaced only as a red CI check on every
push. The hook runs the **same scripts** the workflows run
(`scripts/release/release-notes-check.ts`,
`scripts/perf/perf-section-guard.sh`), so there is no second copy of either
rule; a test fails when a workflow stops calling its script. They are
taken from the checkout the command runs in, falling back to the hook's own
copies only when that checkout has none: hooks load from the main
checkout, so without that a PR changing a check would be judged locally by
main's old rule while CI ran the branch's new one.

It mirrors each workflow's triggers rather than the checks alone. The base
branch and the exempting label are the hook's `ci_base` and `skip_label`,
and a test fails when a workflow's `branches:` filter or label condition
stops naming the same values:

- **Base `main` only**, both workflows' `branches:` filter. `-B/--base`
  decides; otherwise `create` resolves it as gh does — the current branch's
  `gh-merge-base` git config, else the default branch — and `edit` asks
  `gh pr view` for the PR's current base.
- **`skip-version-bump` exempts the release notes.** The label set is what
  the PR will carry after this call: `-l/--label`/`--add-label` add,
  `--remove-label` removes, and on `edit` the PR's existing labels (again
  from `gh pr view`) start the set.
- **The diff is the PR's head against its merge base with
  `origin/<base>`**, files and record count alike, as CI reads the PR. The
  head is the checkout's `HEAD` on a bare `create`; `create -H <branch>`
  uses that branch (or `origin/<branch>`), and `edit` the `headRefOid`
  `gh pr view` reports, so editing one PR from a worktree on another judges
  the right diff. A head this checkout does not hold, or a fork's
  `owner:branch`, lets the call through rather than judging `HEAD`. A stale
  `origin/main` reads a wider diff than GitHub will; fetch first if the
  verdict surprises.
- **A draft is not checked; becoming ready is.** `gh pr create --draft` /
  `-d`, and `edit` of a PR `gh pr view` reports as a draft, pass whatever
  the body: what the gate protects is a PR claiming to be ready when it is
  not, since that is what goes wrong at landing, and a draft claims nothing.
  CI still runs both guards on a draft, and a red check there is expected.
  `gh pr ready [<N>]` is the claim, so it runs both checks on the body
  GitHub holds (read through `gh pr view`, with the PR's base, head and
  labels) and is refused on a failure, pointing at `gh pr edit --body-file`.
  `--undo`, and `ready` on a PR that is not a draft, pass.

**Only a verdict denies.** A check's output carrying `::error::` is a
failure CI would report, and becomes the deny reason (prefix stripped). Any
other non-zero exit means the check could not run — no `origin` ref, not a
git checkout — and the call passes. So does anything the hook cannot read:
an inline `--body`, `-F -` (stdin), a missing file, an `edit` whose PR
`gh` cannot view, or a PR in another repository (`-R`/`--repo`, a
`GH_REPO=` prefix), whose history the local checkout does not hold. This
is a hygiene gate with CI behind it, so it fails **open**, like readme-guard
and unlike perf-guard.

The command is split into shell words by the hook itself — quotes,
backslash escapes and `\`-newline continuations honoured — and stops at the
first unquoted `;`, `&` or `|`, so a title carrying one is read whole.

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
macOS suite stayed green — is [Traps](/scripts/perf/arming/README.md#traps).

## How paper-store-link works

`data/papers/pdf` is a gitignored symlink to a private store
([The PDFs are private](/data/papers/README.md#the-pdfs-are-private)). `.worktreeinclude` cannot carry it: the
copy Claude Code makes when it creates a worktree skips symlinks, so without
this hook every new worktree starts with `tests/citation-index.test.ts`
failing. A `WorktreeCreate` hook is not the fix either — it replaces git's
worktree creation outright rather than running after it.

Hooks load from the main checkout's `.claude/settings.json`, and
`$CLAUDE_PROJECT_DIR` stays at the main checkout after `EnterWorktree`; the
sweep uses it only to find the repo, so either checkout serves.

The hook is a sweep, not a per-worktree copy: it lists the repo's worktrees
(`git worktree list`, whose first entry is the main checkout) and, for each
linked one with no link or a link to a different target, links it to main's
target. A relative target is first resolved against main's `data/papers/`,
since a worktree sits at another depth and would read it as a different
path. So it needs nothing from the payload, works from whichever
checkout the session is in, and reaches worktrees made by hand with
`git worktree add`. Main's link is the authority for where the store is
([The PDFs are private](/data/papers/README.md#the-pdfs-are-private)).

- **It never replaces a real folder or file** at that path — only a missing
  entry or a symlink.
- **Fails open**, like prime-guard: any error exits 0 silently, since a
  missing link is a test failure, not a reason to stop a session.
- **Two events.** SessionStart covers a session opened in an existing
  worktree; PostToolUse on `EnterWorktree` covers one created mid-session.

## Disabling

Two paths:

1. **One call only.** For `readme-guard`: clear the seen-state file
   (`rm ${TMPDIR:-/tmp}/claude-readme-guard/seen-$PPID.txt`).
   For `commit-sweep-guard`: pass `[readme-skip: <reason>]` in the
   commit message (covers the README check; comment violations still
   block — fix the comments), `[comment-ok: <reason>]` for the
   restatement sweep, `[figure-ok: <reason>]` for the snapshot-copy sweep. For `prime-guard`: delete the sentinel
   — any tool call naming that path is allowed through precisely so
   the `rm` isn't itself blocked. For `skill-guard`: invoke the
   skill, which is the intended route rather than an escape. For
   `pr-body-guard`: open the PR as a draft (`gh pr create --draft`).
2. **Across the session.** Remove the entry from its event's array
   under `.claude/settings.json`'s `hooks`, or
   temporarily move the hook script aside.

Disabling is the right call when investigating a folder that
genuinely has no subsystem ownership (e.g. ad-hoc scratch) — but the
default answer is to read or update the README.
