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
  RULES.md              Sticky prose rules, re-injected every turn.
  README.md             This file.
```

## Why the entry point is a re-export

The implementation stays in `scripts/hooks/` so that all four guards, their
tests, and one README sit together; `.omp/extensions/` only needs to name it.

`.omp/extensions/*.ts` is a native discovery root: omp imports it and runs its
default export as an extension factory with no `extensions:` entry in
`config.yml`. Discovery is cwd-only and does not walk ancestors, so it works in
a worktree because `.omp/` is committed, and it applies gitignore filtering, so
the directory must stay tracked.

Two properties made this the entry point over `.omp/hooks/pre/*.ts`, which also
auto-loads as an extension factory:

- `disabledExtensions: [extension-module:stellata-guards]` turns it off. Hook
  paths carry hook-specific ids instead and are not filtered by that list.
- A file under `hooks/pre/` is also a per-tool hook whose *filename* names the
  tool it binds to. Nothing depends on that here, and an entry point whose name
  has a second meaning is a trap.

## What is deliberately absent

- **No `config.yml`.** Nothing project-specific is left to configure once the
  extension auto-loads. A machine-wide `~/.omp/agent/config.yml` still applies.
- **No `tools.approvalMode`.** It would override the operator's machine-wide
  choice. The bridge blocks outright rather than requesting approval, so its
  protection does not depend on the mode.
- **No `bash.patterns` glob for the trunk rule.** The rule depends on where
  HEAD is, not on the text of the command, so no pattern over command text can
  express it. An earlier attempt denied a fully spelled
  `git push origin main` while allowing `git push`, `git push -f`,
  `git push origin HEAD`, and `git -C <path> push origin main`.
- **No `bashInterceptor` rules.** omp documents the interceptor as best-effort
  routing toward dedicated tools, not a security boundary: a rule goes inert
  when its target tool is disabled. In-place-write commands are classified in
  the bridge instead, where a match actually blocks.
