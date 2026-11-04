"""See /src/astro-core/README.md#baker-constants."""

import json

from scripts.util.paths import REPO_ROOT

CONSTANTS_PATH = REPO_ROOT / "src" / "astro-core" / "baker-constants.json"
CONSTANTS = json.loads(CONSTANTS_PATH.read_text())
