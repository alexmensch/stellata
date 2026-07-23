#!/usr/bin/env python3
"""Stdlib-unittest pins for scripts/binaries/stage7_counts.py."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.binaries.stage2_resolve import (  # noqa: E402
    RESOLVE_VIA_VALUES,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ASTROMETRY_VIA_VALUES,
)
from scripts.binaries.stage4_orbits import (  # noqa: E402
    ORBIT_VIA_VALUES,
)
from scripts.binaries.stage5_optical import (  # noqa: E402
    OPTICAL_VIA_VALUES,
    OpticalClassification,
)
from scripts.binaries.stage7_counts import (  # noqa: E402
    DEFAULT_RATE_TOLERANCE,
    UPDATE_COUNTS_ENV_VAR,
    assert_or_update_counts,
    assert_or_update_rates,
    build_binaries_counts,
    build_binaries_rates,
    compare_build_counts,
    compare_build_rates,
)
from scripts.binaries.pipeline_test_fixtures import (  # noqa: E402
    _component_astrometry,
    _resolved,
    _wds_pair,
)


class BuildBinariesCountsTests(unittest.TestCase):
    def test_collects_every_canonical_section(self) -> None:
        # Construct minimal Stage 2-5 outputs and verify every section
        # (resolution / astrometry / orbit / optical) shows up as a
        # flat key prefix.
        counts = build_binaries_counts(
            pairs=[_wds_pair(components="AB")],
            components=[
                _resolved(gaia=1, component="A", is_primary=True),
                _resolved(gaia=2, component="B", is_primary=False),
            ],
            astrometry=[_component_astrometry(), _component_astrometry()],
            orbits=[(None, "none")],
            classifications=[OpticalClassification(True, "wds_notes_kept")],
            multiples_rows=[],
        )
        for tag in RESOLVE_VIA_VALUES:
            self.assertIn(f"resolution_{tag}", counts)
        for tag in ASTROMETRY_VIA_VALUES:
            self.assertIn(f"astrometry_{tag}", counts)
        for tag in ORBIT_VIA_VALUES:
            self.assertIn(f"orbit_{tag}", counts)
        for tag in OPTICAL_VIA_VALUES:
            self.assertIn(f"optical_{tag}", counts)
        self.assertEqual(counts["wds_pairs_total"], 1)
        self.assertEqual(counts["decomposing_pairs"], 1)
        self.assertEqual(counts["components_total"], 2)
        self.assertEqual(counts["optical_wds_notes_kept"], 1)


class CompareBuildCountsTests(unittest.TestCase):
    def test_match_when_equal(self) -> None:
        a = {"x": 1, "y": 2}
        diff = compare_build_counts(a, a)
        self.assertTrue(all(d.status == "match" for d in diff))

    def test_mismatch_signed_delta(self) -> None:
        diff = compare_build_counts({"x": 10, "y": 5}, {"x": 12, "y": 5})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses, {"x": "mismatch", "y": "match"})

    def test_missing_keys_classified(self) -> None:
        diff = compare_build_counts({"a": 1, "b": 2}, {"b": 2, "c": 3})
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses["a"], "missing_actual")
        self.assertEqual(statuses["b"], "match")
        self.assertEqual(statuses["c"], "missing_expected")


class AssertOrUpdateCountsTests(unittest.TestCase):
    def test_writes_initial_snapshot_when_missing(self) -> None:
        import json as _json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            ok = assert_or_update_counts({"x": 1, "y": 2}, p)
            self.assertTrue(ok)
            self.assertTrue(p.exists())
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 1, "y": 2})

    def test_compares_against_existing_snapshot_match(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = assert_or_update_counts({"x": 1, "y": 2}, p)
        self.assertTrue(ok)

    def test_compares_against_existing_snapshot_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1, "y": 2}\n')
            ok = assert_or_update_counts({"x": 1, "y": 3}, p)
            self.assertFalse(ok)
            # Snapshot file must NOT be silently rewritten on mismatch.
            self.assertEqual(p.read_text(), '{"x": 1, "y": 2}\n')

    def test_env_var_forces_update_on_mismatch(self) -> None:
        import json as _json
        import os as _os
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "snapshot.json"
            p.write_text('{"x": 1}\n')
            try:
                _os.environ[UPDATE_COUNTS_ENV_VAR] = "1"
                ok = assert_or_update_counts({"x": 2}, p)
            finally:
                _os.environ.pop(UPDATE_COUNTS_ENV_VAR, None)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written, {"x": 2})


class BuildBinariesRatesTests(unittest.TestCase):
    def _baseline_counts(self) -> dict[str, int]:
        return {
            "components_total": 10000,
            "decomposing_pairs": 5000,
            "resolution_orb6_hip": 100,
            "resolution_athyg_gaia_native": 1000,
            "resolution_simbad_xid": 3400,
            "resolution_ccdm_hip": 500,
            "resolution_position_pm": 0,
            "resolution_position_nopm": 0,
            "resolution_unresolved": 5000,
            "astrometry_gaia_nss_systemic": 100,
            "astrometry_hip2_long_baseline": 200,
            "astrometry_gaia_5p": 2000,
            "astrometry_unresolved": 7700,
            "orbit_gaia_nss": 150,
            "orbit_orb6": 100,
            "orbit_orb6_spectroscopic": 50,
            "orbit_none": 4700,
            "optical_wds_notes_rejected": 500,
            "optical_gaia_rejected": 100,
            "optical_asymm_rejected": 50,
            "optical_mag_heuristic_rejected": 850,
        }

    def test_gaia_resolve_rate_is_source_id_anchored_fraction(self) -> None:
        rates = build_binaries_rates(self._baseline_counts())
        # (100 + 1000 + 3400) / 10000 = 0.45 — ccdm_hip excluded.
        self.assertAlmostEqual(rates["gaia_resolve_rate"], 0.45)

    def test_optical_rejected_rate_sums_cascade_rejections(self) -> None:
        rates = build_binaries_rates(self._baseline_counts())
        # (500 + 100 + 50 + 850) / 5000 = 0.30
        self.assertAlmostEqual(rates["optical_rejected_rate"], 0.30)

    def test_nss_orbit_rate_uses_only_resolved_orbit_population(self) -> None:
        rates = build_binaries_rates(self._baseline_counts())
        # 150 / (150 + 100 + 50) = 0.5
        self.assertAlmostEqual(rates["nss_orbit_rate"], 0.5)

    def test_hip2_fallback_rate_is_per_component_fraction(self) -> None:
        rates = build_binaries_rates(self._baseline_counts())
        # 200 / 10000 = 0.02
        self.assertAlmostEqual(rates["hip2_fallback_rate"], 0.02)

    def test_zero_denominator_returns_zero_rate(self) -> None:
        rates = build_binaries_rates({
            "components_total": 0,
            "decomposing_pairs": 0,
        })
        for key, value in rates.items():
            self.assertEqual(value, 0.0, msg=key)


class CompareBuildRatesTests(unittest.TestCase):
    def test_match_when_within_tolerance(self) -> None:
        expected = {"r": {"value": 0.50, "tolerance": 0.20}}
        diff = compare_build_rates(expected, {"r": 0.55})
        self.assertEqual(diff[0].status, "match")

    def test_drift_when_outside_tolerance(self) -> None:
        expected = {"r": {"value": 0.50, "tolerance": 0.20}}
        diff = compare_build_rates(expected, {"r": 0.65})
        self.assertEqual(diff[0].status, "drift")

    def test_missing_keys_classified(self) -> None:
        expected = {"r1": {"value": 0.5, "tolerance": 0.2}}
        actual = {"r2": 0.3}
        diff = compare_build_rates(expected, actual)
        statuses = {d.key: d.status for d in diff}
        self.assertEqual(statuses, {"r1": "missing_actual", "r2": "missing_expected"})

    def test_negative_or_zero_expected_does_not_divide_by_zero(self) -> None:
        expected = {"r": {"value": 0.0, "tolerance": 0.20}}
        diff = compare_build_rates(expected, {"r": 0.0})
        self.assertEqual(diff[0].status, "match")
        # Tiny actual against zero expected: ratio uses 1e-9 floor, so
        # any non-zero actual exceeds tolerance.
        diff2 = compare_build_rates(expected, {"r": 0.0001})
        self.assertEqual(diff2[0].status, "drift")


class AssertOrUpdateRatesTests(unittest.TestCase):
    def test_writes_initial_snapshot_with_default_tolerance(self) -> None:
        import json as _json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            ok = assert_or_update_rates({"r": 0.42}, p)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written["r"]["value"], 0.42)
        self.assertEqual(written["r"]["tolerance"], DEFAULT_RATE_TOLERANCE)

    def test_preserves_hand_edited_tolerance_on_refresh(self) -> None:
        import json as _json
        import os as _os
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            p.write_text(_json.dumps({"r": {"value": 0.30, "tolerance": 0.05}}))
            try:
                _os.environ[UPDATE_COUNTS_ENV_VAR] = "1"
                ok = assert_or_update_rates({"r": 0.42}, p)
            finally:
                _os.environ.pop(UPDATE_COUNTS_ENV_VAR, None)
            self.assertTrue(ok)
            written = _json.loads(p.read_text())
        self.assertEqual(written["r"]["value"], 0.42)
        # Hand-edited tolerance must survive the refresh.
        self.assertEqual(written["r"]["tolerance"], 0.05)

    def test_returns_false_on_drift_without_rewriting_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rates.json"
            body = '{"r": {"value": 0.50, "tolerance": 0.10}}'
            p.write_text(body)
            ok = assert_or_update_rates({"r": 0.80}, p)
            self.assertFalse(ok)
            self.assertEqual(p.read_text(), body)


if __name__ == "__main__":
    unittest.main()
