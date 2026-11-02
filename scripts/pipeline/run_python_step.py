"""Runs one Python step under build_stamp's recorder: run_python_step.py
<root> <record.json> <entry.py> [args...]. See README.md."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.build_stamp import record_run  # noqa: E402

root, record, entry, *args = sys.argv[1:]
sys.exit(record_run(Path(root), Path(record), Path(entry), args))
