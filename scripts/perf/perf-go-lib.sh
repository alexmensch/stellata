# Shared by scripts/hooks/perf-guard.sh and await-go.sh: where the arm
# marker lives and how fresh it must be. Sourced, never executed.

PERF_GO_MAX_AGE_S=3600

perf_go_marker() {
  local top
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  printf '%s/.perf-go' "$top"
}

perf_go_age_s() {
  local mtime
  mtime="$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1")"
  echo $(( $(date +%s) - mtime ))
}
