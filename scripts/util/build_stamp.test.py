#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/util/build_stamp.py."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.paths import REPO_ROOT  # noqa: E402
from scripts.util.build_stamp import (  # noqa: E402
    changed_since,
    clear_stamp,
    file_hashes,
    imported_script_modules,
    listing_hash,
    outputs_json,
    read_stamp,
    stamp_is_current,
    write_stamp,
)


class BuildStampTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        d = Path(self._tmp.name)
        self.input = d / "input.tsv"
        self.output = d / "output.bin"
        self.stamp = d / "stamps" / "step.json"
        self.input.write_text("a\tb\n")
        self.output.write_text("built")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write(self) -> None:
        write_stamp(self.stamp, file_hashes([self.input]), [self.output])

    def current(self, *inputs: Path) -> bool:
        return stamp_is_current(self.stamp, file_hashes(inputs or (self.input,)))

    def test_stale_without_stamp(self) -> None:
        self.assertFalse(self.current())

    def test_current_for_unchanged_inputs_and_outputs(self) -> None:
        self.write()
        self.assertTrue(self.current())

    def test_touched_input_with_same_content_stays_current(self) -> None:
        self.write()
        later = time.time() + 60
        os.utime(self.input, (later, later))
        self.assertTrue(self.current())

    def test_changed_content_is_stale(self) -> None:
        self.write()
        self.input.write_text("a\tc\n")
        self.assertFalse(self.current())

    def test_absent_input_recorded_as_none_and_its_arrival_is_a_change(self) -> None:
        later = self.input.parent / "later.tsv"
        hashes = file_hashes([self.input, later])
        self.assertIn(None, hashes.values())
        write_stamp(self.stamp, hashes, [self.output])
        self.assertTrue(self.current(self.input, later))
        later.write_text("x")
        self.assertFalse(self.current(self.input, later))

    def test_missing_output_is_stale(self) -> None:
        self.write()
        self.output.unlink()
        self.assertFalse(self.current())

    def test_output_rewritten_elsewhere_is_stale(self) -> None:
        self.write()
        self.output.write_text("built by another commit")
        self.assertFalse(self.current())
        self.assertEqual(len(changed_since(read_stamp(self.stamp).outputs)), 1)

    def test_stamp_without_outputs_reads_as_none(self) -> None:
        self.stamp.parent.mkdir(parents=True)
        self.stamp.write_text(json.dumps({"inputs": file_hashes([self.input])}))
        self.assertIsNone(read_stamp(self.stamp))
        self.assertFalse(self.current())

    def test_truncated_stamp_reads_as_none_and_write_leaves_no_temp(self) -> None:
        self.write()
        self.assertFalse(self.stamp.with_name(self.stamp.name + ".tmp").exists())
        self.stamp.write_text('{"inputs": {')
        self.assertIsNone(read_stamp(self.stamp))
        self.assertFalse(self.current())

    def test_refuses_missing_or_no_outputs(self) -> None:
        self.output.unlink()
        with self.assertRaisesRegex(RuntimeError, "outputs missing"):
            self.write()
        with self.assertRaisesRegex(RuntimeError, "none given"):
            write_stamp(self.stamp, file_hashes([self.input]), [])
        self.assertFalse(self.stamp.exists())

    def test_imported_script_modules_is_the_import_graph(self) -> None:
        names = {p.name for p in imported_script_modules()}
        self.assertIn("build_stamp.py", names)
        self.assertIn("paths.py", names)
        self.assertNotIn("build_stamp.test.py", names)
        self.assertNotIn("component_tokens.py", names)

    def test_outputs_json_is_repo_relative(self) -> None:
        self.assertEqual(
            json.loads(outputs_json(
                [REPO_ROOT / "public" / "a.bin", REPO_ROOT / "build" / "b.tsv"],
                REPO_ROOT / "build" / "stamps" / "step.json",
            )),
            {"outputs": ["public/a.bin", "build/b.tsv"], "stamp": "build/stamps/step.json"},
        )

    def test_clear_stamp(self) -> None:
        self.write()
        clear_stamp(self.stamp)
        self.assertIsNone(read_stamp(self.stamp))
        clear_stamp(self.stamp)


RUN_PYTHON_STEP = REPO_ROOT / "scripts" / "pipeline" / "run_python_step.py"

FIXTURE_STEP = """
import os, sys
from pathlib import Path
from scripts.util.build_stamp import probe
import helper
here = Path(__file__).parent
(here / "input.tsv").read_text()
os.listdir(here / "folder")
probe(here / "maybe.txt")
probe(here / "present.txt")
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

    def test_records_listings_by_directory_over_sorted_names(self) -> None:
        _, record = self.run_step()
        self.assertEqual(record["listings"], {str(self.root / "folder"): listing_hash(["x"])})

    def test_records_probes_made_through_the_helper(self) -> None:
        _, record = self.run_step()
        self.assertEqual(record["probes"], {
            str(self.root / "maybe.txt"): False,
            str(self.root / "present.txt"): True,
        })

    def test_a_temp_then_rename_write_counts_as_its_target_and_a_deleted_scratch_file_not_at_all(self) -> None:
        _, record = self.run_step()
        self.assertEqual(self.rel(record["writes"]), ["ledger.tsv", "out.bin"])

    def test_passes_the_step_exit_status_through_and_still_records(self) -> None:
        status, record = self.run_step(3)
        self.assertEqual(status, 3)
        self.assertIn("writes", record)


if __name__ == "__main__":
    unittest.main()
