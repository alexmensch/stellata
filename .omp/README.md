# omp harness config

Project settings for the `omp` coding harness, the counterpart to
`.claude/settings.json`. Both harnesses read this repo; neither file
supersedes the other.

## Files in this area

```
.omp/
  AGENTS.md    Context bridge. Two @ imports pulling in the root
               CLAUDE.md and AGENTS.md.
  RULES.md     Sticky rules — re-attached near the current turn rather
               than sitting in the opening context.
  config.yml   Project settings: the guard-bridge extension path, the
               push-to-main deny rules, the advisor switch.
```

## Why AGENTS.md exists at all

omp's Claude-compatibility layer reads `.claude/CLAUDE.md` only. This
repo's file is the root `CLAUDE.md`, which matches no omp discovery
provider — the standalone-file provider recognises only files named
`AGENTS.md`. Without this bridge, every stellata-specific rule is absent
from an omp session's context.

`.omp/AGENTS.md` is the native format, so it wins the repo-root scope
outright and shadows the root `AGENTS.md` at the same depth. That is why
it imports **both** files; dropping either import silently loses it.

A `.claude/CLAUDE.md` symlink is the wrong fix — it would win the same
scope at a lower priority and shadow the root `AGENTS.md` with no way to
recover it.

## Array settings replace, they never merge

A higher-precedence layer's array becomes the whole value. `extensions`
here therefore **replaces** any `extensions` list in
`~/.omp/agent/config.yml`. The user-level worktree guard survives that
because it lives in `~/.omp/agent/extensions/`, which is auto-discovered
rather than listed. Anything added to a user-level `extensions` array
would vanish inside this repo.

## Deliberate absences

- **No `tools.approvalMode`.** Setting it here would override the
  machine-wide choice. The `deny` rules in `config.yml` are enforced in
  every mode, including the default `yolo`, so protection does not
  depend on the mode.
- **No `tools.approval.eval`.** `bash.patterns` gates the `bash` tool
  only, and `eval` can spawn a shell by subprocess, so a denied git
  command is reachable through an `eval` cell. Prompting on every `eval`
  call was judged too expensive for a hole that needs the agent to route
  around a refusal on purpose.
- **No `bashInterceptor` for `cat`/`head`/`tail`.** The rule those would
  enforce has a legitimate exemption — piping a file into another
  command without reading it into context — that a regular expression
  cannot express, so the interceptor would deny valid pipelines.

## Guards do not reach subagents

`task` subagents get their own extension runtime and load none of their
own, so the README, commit-sweep, and worktree guards are inert inside a
subagent. Work delegated to a subagent is ungated; no setting changes
this.

## The local-only half

Machine-scoped configuration is not in this repo: the git identity
environment variables, the model roles, the thinking level, and the
user-level worktree guard at `~/.omp/agent/extensions/`. See
`scripts/hooks/README.md` § The omp bridge for what the committed half
wires up.
