#!/usr/bin/env python3
"""Unit tests for edenhofer2024 (no network): the committed identities, the
bake-side require, and the stdlib-only describe."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import edenhofer2024 as e  # noqa: E402


class IdentityTests(unittest.TestCase):
    def test_every_committed_identity_is_what_the_code_reads(self) -> None:
        for variant in e.VARIANTS:
            self.assertEqual(json.loads(e.identity_path(variant).read_text()), e.identity(variant))

    def test_every_flavor_names_one_variant(self) -> None:
        self.assertEqual(e.FLAVOR_VARIANT, {"main": "main", "less_data_but_2kpc": "2kpc"})


class RequireTests(unittest.TestCase):
    def _at(self, root: Path):
        return mock.patch.multiple(
            e, REPO_ROOT=root,
            identity_path=lambda variant: root / f"edenhofer2024-{variant}.json",
        )

    def test_names_the_pull_when_the_identity_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as d, self._at(Path(d)):
            with self.assertRaisesRegex(SystemExit, "refresh:edenhofer2024-2kpc"):
                e.require("less_data_but_2kpc")

    def test_refuses_an_identity_that_names_another_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as d, self._at(Path(d)):
            (Path(d) / "edenhofer2024-main.json").write_text(json.dumps({**e.identity("main"), "md5": "0"}))
            with self.assertRaisesRegex(SystemExit, "different dataset"):
                e.require("main")

    def test_returns_a_matching_identity(self) -> None:
        with tempfile.TemporaryDirectory() as d, self._at(Path(d)):
            (Path(d) / "edenhofer2024-main.json").write_text(json.dumps(e.identity("main")))
            self.assertEqual(e.require("main"), e.identity("main"))


class DescribeTests(unittest.TestCase):
    def test_each_entry_describes_its_variant_under_isolated_stdlib_python(self) -> None:
        refresh = Path(__file__).resolve().parents[1] / "refresh"
        for variant in e.VARIANTS:
            out = subprocess.run(
                ["python3", "-I", "-S", str(refresh / f"refresh-edenhofer2024-{variant}.py"), "--describe"],
                capture_output=True, text=True, check=True,
            )
            described = json.loads(out.stdout)
            self.assertEqual(json.loads(described["query"]), e.identity(variant))
            self.assertEqual(described["services"], ["zenodo.org"])


if __name__ == "__main__":
    unittest.main()
