#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/util/build_stamp.py."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.paths import REPO_ROOT  # noqa: E402


RUN_PYTHON_STEP = REPO_ROOT / "scripts" / "pipeline" / "run_python_step.py"

FIXTURE_STEP = """
import os, sys
from pathlib import Path
from scripts.util.build_stamp import probe, report_service
import helper
here = Path(__file__).parent
(here / "input.tsv").read_text()
os.listdir(here / "folder")
probe(here / "maybe.txt")
probe(here / "present.txt")
for name in ("ESA-sync", "ARI-sync", "ESA-sync"):
    report_service(name)
tmp = here / "out.bin.tmp"
tmp.write_text("built")
os.replace(tmp, here / "out.bin")
(here / "out.bin").read_text()
(here / "scratch.txt").write_text("gone")
os.remove(here / "scratch.txt")
(here / "ledger.tsv").read_text()
with open(here / "ledger.tsv", "a") as f:
    f.write("row\\n")
sys.exit(int(sys.argv[1]))
"""


class RecorderTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        (self.root / "step.py").write_text(FIXTURE_STEP)
        (self.root / "helper.py").write_text("VALUE = 1\n")
        (self.root / "input.tsv").write_text("a\n")
        (self.root / "present.txt").write_text("p\n")
        (self.root / "ledger.tsv").write_text("head\n")
        (self.root / "folder").mkdir()
        (self.root / "folder" / "x").write_text("")
        self.record = self.root / "record.json"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def run_step(self, status: int = 0) -> tuple[int, dict]:
        proc = subprocess.run(
            [sys.executable, str(RUN_PYTHON_STEP), str(self.root), str(self.record),
             str(self.root / "step.py"), str(status)],
            capture_output=True, text=True,
        )
        return proc.returncode, json.loads(self.record.read_text())

    def rel(self, keys) -> list[str]:
        return sorted(Path(k).relative_to(self.root).as_posix() for k in keys)

    def test_records_reads_with_their_hashes_and_loaded_modules(self) -> None:
        _, record = self.run_step()
        self.assertEqual(self.rel(record["reads"]), ["helper.py", "input.tsv", "ledger.tsv", "step.py"])
        self.assertEqual(record["reads"][str(self.root / "input.tsv")], hashlib.sha1(b"a\n").hexdigest())

    def test_a_file_read_before_it_is_appended_to_is_both_input_and_write(self) -> None:
        _, record = self.run_step()
        self.assertEqual(record["reads"][str(self.root / "ledger.tsv")], hashlib.sha1(b"head\n").hexdigest())
        self.assertIn(str(self.root / "ledger.tsv"), record["writes"])

    def test_a_file_read_after_the_step_wrote_it_is_not_an_input(self) -> None:
        _, record = self.run_step()
        self.assertNotIn(str(self.root / "out.bin"), record["reads"])

    def test_records_listings_by_directory_as_sorted_names(self) -> None:
        (self.root / "folder" / "a").write_text("")
        _, record = self.run_step()
        self.assertEqual(record["listings"], {str(self.root / "folder"): ["a", "x"]})

    def test_records_probes_made_through_the_helper(self) -> None:
        _, record = self.run_step()
        self.assertEqual(record["probes"], {
            str(self.root / "maybe.txt"): False,
            str(self.root / "present.txt"): True,
        })

    def test_records_each_answering_service_once_in_first_answer_order(self) -> None:
        _, record = self.run_step()
        self.assertEqual(record["services"], ["ESA-sync", "ARI-sync"])

    def test_a_temp_then_rename_write_counts_as_its_target_and_a_deleted_scratch_file_not_at_all(self) -> None:
        _, record = self.run_step()
        self.assertEqual(self.rel(record["writes"]), ["ledger.tsv", "out.bin"])

    def test_leaves_out_the_modules_the_recorder_itself_loaded(self) -> None:
        (self.root / "step.py").write_text("import sys\nimport helper\n")
        proc = subprocess.run(
            [sys.executable, "-c",
             "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]);"
             "import helper; from scripts.util.build_stamp import record_run;"
             "sys.exit(record_run(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), []))",
             str(self.root), str(self.record), str(self.root / "step.py")],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        record = json.loads(self.record.read_text())
        self.assertEqual(self.rel(record["reads"]), ["step.py"])

    def test_ignores_modules_and_files_under_a_virtualenv(self) -> None:
        lib = self.root / ".venv" / "lib"
        lib.mkdir(parents=True)
        (lib / "thirdparty.py").write_text("VALUE = 2\n")
        (self.root / "step.py").write_text(
            f"import sys\nsys.path.insert(0, {str(lib)!r})\nimport thirdparty\n"
        )
        _, record = self.run_step()
        self.assertEqual(self.rel(record["reads"]), ["step.py"])

    def test_passes_the_step_exit_status_through_and_still_records(self) -> None:
        status, record = self.run_step(3)
        self.assertEqual(status, 3)
        self.assertIn("writes", record)


if __name__ == "__main__":
    unittest.main()
