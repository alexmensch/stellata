"""See /src/astro-core/README.md#baker-constants."""

import json

from scripts.util.paths import REPO_ROOT

CONSTANTS_PATH = REPO_ROOT / "src" / "astro-core" / "baker-constants.json"
CONSTANTS = json.loads(CONSTANTS_PATH.read_text())


def merge_shared(sources: dict, shared: dict, facts) -> dict:
    """Each `sources` row plus `facts(shared[name])`; refuses unless both are
    keyed by exactly the same names."""
    assert sources.keys() == shared.keys(), (sources.keys(), shared.keys())
    return {name: {**spec, **facts(shared[name])} for name, spec in sources.items()}
