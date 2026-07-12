#!/bin/bash
# Provisions a Stellata dev environment for Claude Code on the web:
# Git LFS catalog inputs, pnpm deps, and beads (bd) pinned to the schema
# the remote Dolt database expects. Idempotent; logs to stderr so it can
# run alongside the `bd prime` SessionStart hook without polluting its
# JSON stdout. Web sessions only — local machines are already set up.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# bd MUST match the version that owns the remote Dolt schema. A newer bd
# refuses to auto-migrate a remote-backed clone (it would fork the schema
# and break `bd dolt pull`/push). Bump this only in lockstep with a
# deliberate, pushed schema migration on every other machine.
BD_VERSION="v1.0.5"

REPO="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$REPO" || exit 0
# Node 22 first: /usr/local/bin/node is an older v20 that pnpm rejects.
export PATH="/opt/node22/bin:/usr/local/bin:/usr/local/go/bin:$PATH"

log() { echo "[session-start] $*" >&2; }

# --- 1. Git LFS: fill in the pointer stubs the build pipeline reads ---
if ! command -v git-lfs >/dev/null 2>&1; then
  log "installing git-lfs"
  apt-get install -y git-lfs >/dev/null 2>&1 || sudo apt-get install -y git-lfs >/dev/null 2>&1 || log "git-lfs install failed"
fi
if command -v git-lfs >/dev/null 2>&1; then
  git lfs install --local >/dev/null 2>&1 || true
  # Pull only when a known input is still a pointer stub (fast no-op when warm).
  if head -c 40 data/athyg/athyg_33_classic_ids.csv 2>/dev/null | grep -q "git-lfs"; then
    log "pulling LFS data (~630 MB, one-time)"
    git lfs pull || log "git lfs pull failed — build:catalog will not work"
  fi
fi

# --- 2. Node deps ---
if command -v pnpm >/dev/null 2>&1; then
  log "pnpm install"
  pnpm install --prefer-offline >&2 || log "pnpm install failed"
fi

# --- 3. beads (bd) ---
if ! { command -v bd >/dev/null 2>&1 && bd version 2>/dev/null | grep -q "${BD_VERSION#v}"; }; then
  log "installing bd ${BD_VERSION} (go build, one-time)"
  CGO_ENABLED=1 GOBIN=/usr/local/bin GOFLAGS="-tags=gms_pure_go" \
    go install "github.com/steveyegge/beads/cmd/bd@${BD_VERSION}" >&2 \
    || log "bd install failed"
fi
# Hydrate the local Dolt working copy from the remote when absent.
# Read-only clone; never migrates or pushes, so the remote data is untouched.
if command -v bd >/dev/null 2>&1 && [ ! -d "$REPO/.beads/embeddeddolt" ]; then
  log "hydrating beads database (bd bootstrap)"
  BD_NON_INTERACTIVE=1 bd bootstrap --yes >&2 || log "bd bootstrap failed"
fi

exit 0
