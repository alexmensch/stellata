# Sourced by heavy.sh and build-seed.sh: ticket files named <start ns>.<pid>, their liveness, and stopping a process group.

# The stamp is taken and the ticket written under one lock, so tickets appear in the order their names sort;
# flock is released by the kernel when python exits, however it exits.
queue_register() {
  python3 -c '
import fcntl, os, sys, time
queue, pid, content = sys.argv[1:]
with open(os.path.join(queue, ".lock"), "w") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    path = os.path.join(queue, f"{time.time_ns()}.{pid}")
    with open(path, "w") as ticket:
        ticket.write(content + "\n")
print(path)
' "$1" "$$" "$2"
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
