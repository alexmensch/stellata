"""Holds a run's step locks: lock_holder.py <dir> ex:<name>|sh:<name>...
Takes each flock in the order given, prints "locked", and holds them until
stdin closes. See README.md."""

import fcntl
import sys
from pathlib import Path

lock_dir = Path(sys.argv[1])
lock_dir.mkdir(parents=True, exist_ok=True)
held = []
for spec in sys.argv[2:]:
    mode, name = spec.split(":", 1)
    f = open(lock_dir / name, "a")
    fcntl.flock(f, fcntl.LOCK_EX if mode == "ex" else fcntl.LOCK_SH)
    held.append(f)
print("locked", flush=True)
sys.stdin.read()
