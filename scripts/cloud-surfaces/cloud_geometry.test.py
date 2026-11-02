#!/usr/bin/env python3
"""Unit tests for cloud_geometry: the projection of clouds.json the bake's
record hashes."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cloud_geometry as g  # noqa: E402

CLOUD = {"id": "orion-a", "sid": 7, "name": "Orion A", "center": [1, 2, 3], "axes": [4, 5, 6], "quat": [0, 0, 0, 1], "inGrid": True}


class GeometryLinesTests(unittest.TestCase):
    def test_a_sid_or_name_change_leaves_the_projection_unchanged(self) -> None:
        renamed = {**CLOUD, "sid": 8, "name": "Orion A cloud"}
        self.assertEqual(g.geometry_lines({"clouds": [CLOUD]}), g.geometry_lines({"clouds": [renamed]}))

    def test_every_field_the_trace_reads_moves_it(self) -> None:
        for field, moved in [("center", [1, 2, 4]), ("axes", [4, 5, 7]), ("quat", [0, 0, 1, 0]), ("inGrid", False), ("id", "orion-b")]:
            with self.subTest(field=field):
                self.assertNotEqual(
                    g.geometry_lines({"clouds": [CLOUD]}),
                    g.geometry_lines({"clouds": [{**CLOUD, field: moved}]}),
                )

    def test_names_clouds_json_as_the_file_it_projects(self) -> None:
        self.assertEqual(g.CLOUDS_JSON.relative_to(g.REPO).as_posix(), "public/clouds.json")


if __name__ == "__main__":
    unittest.main()
