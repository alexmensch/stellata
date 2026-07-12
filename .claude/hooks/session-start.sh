#!/bin/bash
# Provisions a Stellata dev environment for Claude Code on the web so builds,
# tests, and beads work out of the box. Idempotent: every step is guarded to
# be a fast no-op once the artifact is present, so it is cheap to re-run.
#
# Two entry points call this same script (see .claude/README.md):
#   - the environment Setup script (runs once, result cached in the snapshot —
#     this is where the ~630 MB LFS pull and bd compile actually happen)
#   - the SessionStart hook registered in .claude/settings.json (runs every
#     session as a guarded no-op, plus re-wires git hooks)
#
# Logs go to stderr so stdout stays clean for the sibling `bd prime` hook.
# Web sessions only — local machines are already set up.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-$PWD}")" || exit 0
# Node 22 first: /usr/local/bin/node is an older v20 that pnpm rejects.
export PATH="/opt/node22/bin:/usr/local/bin:/usr/local/go/bin:$PATH"

# bd MUST match the version that owns the remote Dolt schema. A newer bd
# refuses to auto-migrate a remote-backed clone (it would fork the schema and
# break `bd dolt pull`/push). Bump only in lockstep with a deliberate, pushed
# schema migration on every other machine.
BD_VERSION="v1.0.5"

log() { echo "[session-start] $*" >&2; }
lfs_is_stub() { head -c 40 data/athyg/athyg_33_classic_ids.csv 2>/dev/null | grep -q "git-lfs"; }
have_bd() { command -v bd >/dev/null 2>&1 && bd version 2>/dev/null | grep -q "${BD_VERSION#v}"; }

# Install the pinned bd. Primary path is the prebuilt release binary (fast,
# no toolchain) — this assumes the environment has open web access to GitHub
# releases. Falls back to a from-source go build if the download fails.
install_bd() {
  local arch tmp tarball url bin
  case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) arch="" ;;
  esac
  if [ -n "$arch" ]; then
    tarball="beads_${BD_VERSION#v}_$(uname -s | tr '[:upper:]' '[:lower:]')_${arch}.tar.gz"
    url="https://github.com/gastownhall/beads/releases/download/${BD_VERSION}/${tarball}"
    tmp="$(mktemp -d)"
    if curl -fsSL "$url" -o "$tmp/$tarball" && tar -xzf "$tmp/$tarball" -C "$tmp"; then
      bin="$(find "$tmp" -type f -name bd | head -1)"
      if [ -n "$bin" ] && install -m 0755 "$bin" /usr/local/bin/bd; then
        rm -rf "$tmp"; return 0
      fi
    fi
    rm -rf "$tmp"
  fi
  log "release binary unavailable — falling back to go build"
  CGO_ENABLED=1 GOBIN=/usr/local/bin GOFLAGS="-tags=gms_pure_go" \
    go install "github.com/steveyegge/beads/cmd/bd@${BD_VERSION}"
}

# --- git-lfs binary (quick) ---
if ! command -v git-lfs >/dev/null 2>&1; then
  log "installing git-lfs"
  apt-get install -y git-lfs >/dev/null 2>&1 || sudo apt-get install -y git-lfs >/dev/null 2>&1 || log "git-lfs install failed"
fi
command -v git-lfs >/dev/null 2>&1 && git lfs install --local >/dev/null 2>&1 || true

# --- heavy installs in parallel (each guarded; skipped when already present) ---
# Run under the environment Setup script this is a one-time cost baked into the
# snapshot; under the SessionStart hook these are all no-ops on a warm cache.
pids=""
if command -v git-lfs >/dev/null 2>&1 && lfs_is_stub; then
  log "pulling LFS catalog inputs (~630 MB, cached in the environment snapshot)"
  git lfs pull >&2 & pids="$pids $!"
fi
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --prefer-offline >&2 & pids="$pids $!"
fi
if ! have_bd; then
  log "installing bd ${BD_VERSION}"
  install_bd >&2 & pids="$pids $!"
fi
for p in $pids; do wait "$p" || log "an install step failed — see output above"; done

# --- beads DB + git hooks (need bd on PATH) ---
if command -v bd >/dev/null 2>&1; then
  # Hydrate the local Dolt working copy from the remote when absent.
  # Read-only clone; never migrates or pushes, so the remote data is untouched.
  if [ ! -d .beads/embeddeddolt ]; then
    log "hydrating beads database (bd bootstrap)"
    BD_NON_INTERACTIVE=1 bd bootstrap --yes >&2 || log "bd bootstrap failed"
  fi
  # Wire beads git hooks into .git/hooks, chaining the git-lfs hooks. This is
  # what makes `git push` run `bd dolt push` so bead changes sync back.
  bd hooks install --chain >&2 || log "bd hooks install failed"
fi

exit 0
