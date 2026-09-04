# Shared by scripts/hooks/perf-guard.sh and await-go.sh: the arm marker's
# name, where it lives and how fresh it must be. Sourced, never executed.
# scripts/perf/perf-go-lib.ts parses these two values for the runner.

PERF_GO_MARKER_NAME=.perf-go
PERF_GO_MAX_AGE_S=3600

perf_go_marker() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  printf '%s/%s' "$top" "$PERF_GO_MARKER_NAME"
}

# GNU spelling first, and the order is load-bearing: BSD's -f is GNU's
# --file-system, which SUCCEEDS on Linux and prints prose instead of an
# mtime, so failure cannot be the discriminator. Each spelling assigns
# separately — one shared capture would concatenate both outputs.
perf_go_age_s() {
  local mtime
  mtime="$(stat -c %Y "$1" 2>/dev/null)" || mtime="$(stat -f %m "$1" 2>/dev/null)" || return 1
  case "$mtime" in
    '' | *[!0-9]*) return 1 ;;
  esac
  echo $(( $(date +%s) - mtime ))
}
