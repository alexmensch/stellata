#!/usr/bin/env python3
"""Unit tests for python_tests.py: discovery, and which results count as passing."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import python_tests as pt  # noqa: E402


def _result_of(*cases: type[unittest.TestCase]) -> unittest.TestResult:
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in cases)
    result = unittest.TestResult()
    suite.run(result)
    return result


class _Cases:
    """Held off module level, so the loader running this file never collects them."""

    class Passes(unittest.TestCase):
        def test_it(self) -> None:
            pass

    class Fails(unittest.TestCase):
        def test_it(self) -> None:
            self.fail("boom")

    class Errors(unittest.TestCase):
        def test_it(self) -> None:
            raise RuntimeError("boom")

    class Skips(unittest.TestCase):
        def test_it(self) -> None:
            self.skipTest("library absent")

    class UnexpectedlyPasses(unittest.TestCase):
        @unittest.expectedFailure
        def test_it(self) -> None:
            pass


class OutcomeTests(unittest.TestCase):
    def test_a_clean_run_passes(self) -> None:
        self.assertIs(pt.outcome_of(_result_of(_Cases.Passes)), pt.Outcome.PASSED)

    def test_a_failure_or_error_fails(self) -> None:
        self.assertIs(pt.outcome_of(_result_of(_Cases.Passes, _Cases.Fails)), pt.Outcome.FAILED)
        self.assertIs(pt.outcome_of(_result_of(_Cases.Passes, _Cases.Errors)), pt.Outcome.FAILED)

    def test_an_unexpected_success_fails(self) -> None:
        self.assertIs(pt.outcome_of(_result_of(_Cases.UnexpectedlyPasses)), pt.Outcome.FAILED)

    def test_one_skip_among_passes_does_not_pass(self) -> None:
        self.assertIs(pt.outcome_of(_result_of(_Cases.Passes, _Cases.Skips)), pt.Outcome.SKIPPED)

    def test_a_suite_that_runs_nothing_does_not_pass(self) -> None:
        self.assertIs(pt.outcome_of(unittest.TestResult()), pt.Outcome.SKIPPED)

    def test_a_failure_outranks_a_skip(self) -> None:
        self.assertIs(pt.outcome_of(_result_of(_Cases.Skips, _Cases.Fails)), pt.Outcome.FAILED)


class ExitCodeTests(unittest.TestCase):
    def test_every_outcome_round_trips_through_its_exit_code(self) -> None:
        for outcome in pt.Outcome:
            self.assertIs(pt.outcome_from_exit(outcome.value), outcome)

    def test_an_unknown_exit_code_is_a_failure(self) -> None:
        for code in (2, -11, 137):
            self.assertIs(pt.outcome_from_exit(code), pt.Outcome.FAILED)


class DiscoveryTests(unittest.TestCase):
    def test_finds_dotted_and_kebab_names_at_any_depth_and_nothing_else(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            wanted = [root / "a" / "stage2_resolve.test.py", root / "b" / "c" / "refresh-x.test.py"]
            for path in [*wanted, root / "a" / "stage2_resolve.py", root / "a" / "x.test.ts"]:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("")
            self.assertEqual(pt.discover(root), sorted(wanted))

    def test_the_tree_scan_includes_this_suite(self) -> None:
        self.assertIn(Path(__file__).resolve(), pt.discover())


if __name__ == "__main__":
    unittest.main()
