"""Repo-root path shared by every top-level build/refresh script.
See scripts/util/README.md."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
