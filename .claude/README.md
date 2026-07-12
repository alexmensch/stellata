# `.claude/` — Claude Code project config

Config that ships with the repo so Claude Code sessions (local and web)
behave consistently.

- `settings.json` — hooks (README/commit guards, and the SessionStart
  chain that provisions web sessions then runs `bd prime`).
- `hooks/session-start.sh` — idempotent provisioner for **Claude Code on
  the web**: Git LFS data, `pnpm install`, `bd` (pinned), the beads DB, and
  the beads git hooks. Web-only (`CLAUDE_CODE_REMOTE`); a no-op locally.

## Web environment: two-part setup (why both)

Cloud sessions have two provisioning surfaces with different caching
(see the Claude Code on the web docs, "Environment caching"):

| Surface | Runs | Cached? |
|---|---|---|
| **Setup script** (environment config, in the web UI) | once, before Claude launches; re-runs only when the setup script / network config changes or the ~7-day cache expires | **Yes** — the filesystem is snapshotted afterward and reused |
| **SessionStart hook** (`hooks/session-start.sh`) | every session, after launch | No |

The heavy, bandwidth-costly work (the ~630 MB `git lfs pull`, the `bd`
install, the Dolt clone) must run in the **Setup script** so it lands in
the cached snapshot and is **not** re-downloaded every session. GitHub LFS
bandwidth is billed to the repo owner, so per-session pulls are expensive;
per-cache-build pulls (~weekly) are not.

Both surfaces run the **same** `hooks/session-start.sh` (every step is
guarded, so the SessionStart pass is a fast no-op on a warm snapshot and
only re-does work the cache is somehow missing).

### Configure it

In the environment settings (**Setup script** field), paste:

```bash
cd "$(git rev-parse --show-toplevel)" && CLAUDE_CODE_REMOTE=true bash .claude/hooks/session-start.sh
```

The SessionStart hook is already registered in `settings.json`; nothing to
do there.

## bd version pin

`session-start.sh` pins `BD_VERSION` to match the schema the remote Dolt
database expects. A newer `bd` refuses to auto-migrate a remote-backed
clone (it forks the schema and breaks `bd dolt pull`/push). Bump the pin
only in lockstep with a deliberate, pushed schema migration on every other
machine.

bd installs from the prebuilt release binary for `BD_VERSION`, which needs
web access to GitHub releases — fine under the environment's **permissive**
network setting. If that download fails it falls back to a from-source
`go install` (Go is pre-installed).
