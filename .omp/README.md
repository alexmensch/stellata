# omp harness configuration

Project-scoped configuration for the omp coding agent, the second harness this
repo is worked in. Claude Code's equivalent lives in `.claude/`.

## Files in this area

```
.omp/
  extensions/
    stellata-guards.ts  Re-exports the bridge factory from
                        scripts/hooks/omp-bridge.ts. omp auto-discovers
                        .ts under .omp/extensions with no config entry,
                        so this file is the whole wiring.
  rules/
    bd-prime.md         `bd prime --full` as an always-apply rule, so
                        the memories are in the system prompt every
                        turn instead of behind a gate.
    code-comments.md    TTSR trigger: the forbidden comment patterns,
                        refused as an edit is written.
  config.yml            Per-tool approval routing for the two tools the
                        bridge cannot classify. Nothing else.
  RULES.md              Sticky prose rules, re-injected every turn.
  README.md             This file.
```

Both files under `rules/` are generated — `pnpm run build:omp-rules`.
They are committed because rule discovery applies gitignore filtering,
and because a rule set that only exists on one machine is not a rule.

## Why the entry point is a re-export

The implementation stays in `scripts/hooks/` so that all four guards, their
tests, and one README sit together; `.omp/extensions/` only needs to name it.

`.omp/extensions/*.ts` is a native discovery root: omp imports it and runs its
default export as an extension factory with no `extensions:` entry in
`config.yml`. It applies gitignore filtering, so the directory must stay
tracked.

**Discovery is cwd-only and does not walk ancestors.** That is why a worktree
works — `.omp/` is committed, so every worktree has its own copy at its own
root. It is also the one way the whole thing goes silently inert: launch `omp`
from `src/client/` or any other subdirectory and no extension loads, no guard
runs, and nothing says so. Start sessions at the repository root.

Two properties made this the entry point over `.omp/hooks/pre/*.ts`, which also
auto-loads as an extension factory:

- `disabledExtensions: [extension-module:stellata-guards]` turns it off. Hook
  paths carry hook-specific ids instead and are not filtered by that list.
- A file under `hooks/pre/` is also a per-tool hook whose *filename* names the
  tool it binds to. Nothing depends on that here, and an entry point whose name
  has a second meaning is a trap.

## What is deliberately absent

- **No `tools.approvalMode`.** It would override the operator's machine-wide
  choice. `tools.approval.<tool>` in `config.yml` does not: omp honours it in
  every mode, `yolo` included, which is what makes the `eval` / `hub` routing
  above possible without touching the mode.
- **No `bash.patterns` glob for the trunk rule.** The rule depends on where
  HEAD is, not on the text of the command, so no pattern over command text can
  express it. An earlier attempt denied a fully spelled
  `git push origin main` while allowing `git push`, `git push -f`,
  `git push origin HEAD`, and `git -C <path> push origin main`. `bash.patterns`
  also feeds only the `bash` tool's approval decision, so a `deny` there does
  nothing about the same command run through `eval`.
- **No `bashInterceptor` rules.** omp documents the interceptor as best-effort
  routing toward dedicated tools, not a security boundary: a rule goes inert
  when its target tool is disabled. In-place-write commands are classified in
  the bridge instead, where a match actually blocks.

## Why `RULES.md` stays short

A user-level `~/.omp/agent/RULES.md` would shadow this file outright rather
than concatenating with it — both synthesize under the fixed rule name `RULES`
and dedup is by name. No such file exists on the current machine, so this one
is live; it is kept to rules `AGENTS.md` also carries in full so that adding
one later degrades the session rather than breaking it.
