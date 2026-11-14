# Sourced by heavy.sh and build-seed.sh: ticket files named <start ns>.<pid>, their liveness, and stopping a process group.

queue_register() {
  local path
  path="$1/$(python3 -c 'import time; print(time.time_ns())').$$"
  printf '%s\n' "$2" > "$path"
  echo "$path"
}

queue_live() {
  local name=${1##*/}
  grep -q "$2" <<< "$(ps -o command= -p "${name##*.}" 2>/dev/null)"
}

stop_group() {
  kill -TERM -- "-$1" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 -- "-$1" 2>/dev/null || return 0
    sleep 1
  done
  kill -KILL -- "-$1" 2>/dev/null || true
}
