"""See data/schema/README.md."""

import json

from scripts.util.paths import REPO_ROOT

CONSTANTS_PATH = REPO_ROOT / "data" / "schema" / "constants.json"
CONSTANTS = json.loads(CONSTANTS_PATH.read_text())
