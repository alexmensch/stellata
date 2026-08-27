# omp harness config

Project settings for the `omp` coding harness, the counterpart to
`.claude/settings.json`. Both harnesses read this repo; neither file
supersedes the other. `CLAUDE.md` § Repo layout deliberately omits this
folder — harness config carries no project architecture.

## Files in this area

```
.omp/
  AGENTS.md    Context bridge. One @ import pulling in CLAUDE.md.
  RULES.md     Sticky rules — re-attached near the current turn rather
               than sitting in the opening context.
  config.yml   Project settings: the guard-bridge extension path, the
               worktree-guard override, the advisor switch.
```

## Why AGENTS.md exists at all

omp's Claude-compatibility layer reads `.claude/CLAUDE.md` only. This
repo's file is the root `CLAUDE.md`, which matches no omp discovery
provider — the standalone-file provider recognises only files named
`AGENTS.md`. Without this bridge, every stellata-specific rule is absent
from an omp session's context.

`.omp/AGENTS.md` is the native format, so it wins the repo-root scope
outright and shadows the root `AGENTS.md` at the same depth. That costs
nothing now that the root file is a pointer at `CLAUDE.md` carrying no
unique content of its own — the one import is the whole bridge.

A `.claude/CLAUDE.md` symlink is the wrong fix — it would win the same
scope at a lower priority and shadow the root `AGENTS.md` with no way to
recover it.

## RULES.md can be shadowed by a user-level file

Both the project and user sticky-rule files are synthesized under the
fixed rule name `RULES`, and rule deduplication is name-based rather than
concatenating. A developer who keeps a `~/.omp/agent/RULES.md` therefore
sees **none** of this repo's hard requirements, silently. Nothing in the
repo can detect that; the mitigation is that `RULES.md` restates rules
`CLAUDE.md` already carries in full, so a shadowed session still has them
as ordinary context.

## Array settings replace, they never merge

A higher-precedence layer's array becomes the whole value. `extensions`
here therefore **replaces** any `extensions` list in
`~/.omp/agent/config.yml`, and the same applies to every array-typed
setting. Anything added to a user-level `extensions` array would vanish
inside this repo.

Auto-discovery is a separate stage and survives that replacement:
`~/.omp/agent/extensions/` still loads. `disabledExtensions` is how a
project opts out of one of those, which is what `config.yml` does for the
machine-wide worktree guard.

## Who enforces the worktree and trunk rules

`scripts/hooks/omp-bridge.ts` does, for this repo — it already resolves
every path a tool call touches for the README guard, so the main-worktree
test rides on that one tested extractor. `config.yml` disables the
machine-wide `worktree-guard` extension here so the two cannot drift; that
extension stays the fallback for repos carrying no bridge.

The bridge also refuses a `git commit` or `git push` whose current branch
is `main`/`master`. That check reads the branch, which is why it is a
handler and not a `bash.patterns` glob: the rule depends on where HEAD is,
not on the text of the command, so no pattern over command text can
express it. An earlier revision tried — it allowed bare `git push`,
`git push origin HEAD`, `git -C <path> push origin main`, and denied any
branch merely *starting* with `main`.

## Deliberate absences

- **No `tools.approvalMode`.** Setting it here would override the
  machine-wide choice. The bridge blocks a tool call outright rather than
  requesting approval, so its protection does not depend on the mode.
- **No `bash.patterns`.** See above: the rules worth enforcing here are
  branch-dependent, and a glob over command text cannot express them.
- **No `tools.approval.eval`.** `eval` can spawn a shell by subprocess, so
  a git command is reachable through an `eval` cell without passing the
  bridge's `bash` branch. Prompting on every `eval` call was judged too
  expensive for a hole that needs the agent to route around a refusal on
  purpose.
- **No `bashInterceptor` for `cat`/`head`/`tail`.** The rule those would
  enforce has a legitimate exemption — piping a file into another
  command without reading it into context — that a regular expression
  cannot express, so the interceptor would deny valid pipelines.
- **No `advisor.syncBacklog`.** `off` is already the default, and bare
  `off` in YAML parses as boolean `false` against a setting that wants the
  string, so writing it out is a bug waiting to be copied.

## Guards do not reach subagents

`task` subagents get their own extension runtime. omp's documentation
states this for a subagent spawned with restricted tools and does not
settle the unrestricted case, so treat delegated work as **possibly**
ungated rather than provably either way — the README, commit-sweep,
worktree and trunk checks may all be inert inside one. Subagents also run
with `approvalMode` forced to `yolo`, so nothing prompts there.

## The local-only half

Machine-scoped configuration is not in this repo: the git identity
environment variables, the model roles, the thinking level, and the
fallback worktree guard at `~/.omp/agent/extensions/`. See
`scripts/hooks/README.md` § The omp bridge for what the committed half
wires up.
