#!/usr/bin/env python3
"""Unit tests for refresh_lib. Run via `python3 scripts/refresh/refresh_lib.test.py`."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import refresh_lib as rl  # noqa: E402


class DescribeTests(unittest.TestCase):
    def test_states_only_what_was_given(self) -> None:
        self.assertEqual(rl.description("SELECT 1", ["CDS"]), {"query": "SELECT 1", "services": ["CDS"]})

    def test_states_a_derived_request_and_its_source_repo_relative(self) -> None:
        described = rl.description(
            "Q", ["SIMBAD-CDS"], release="R", request=iter(["a", "b"]),
            request_from=[rl.REPO_ROOT / "data" / "membership" / "membership-manifest.tsv"],
        )
        self.assertEqual(described, {
            "query": "Q", "services": ["SIMBAD-CDS"], "release": "R", "request": ["a", "b"],
            "requestFrom": ["data/membership/membership-manifest.tsv"],
        })

    def test_pull_main_describes_without_running(self) -> None:
        ran: list[int] = []
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["x.py", "--describe"]), contextlib.redirect_stdout(out):
            rl.pull_main(lambda: ran.append(1), lambda: {"query": "Q", "services": ["S"]})
        self.assertEqual(ran, [])
        self.assertEqual(json.loads(out.getvalue()), {"query": "Q", "services": ["S"]})

    def test_pull_main_exits_with_the_run_status(self) -> None:
        with mock.patch.object(sys, "argv", ["x.py"]), self.assertRaises(SystemExit) as exit_:
            rl.pull_main(lambda: 3, lambda: {})
        self.assertEqual(exit_.exception.code, 3)


if __name__ == "__main__":
    unittest.main()
