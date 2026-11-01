"""See data/schema/README.md."""

import json

from scripts.util.paths import REPO_ROOT

CONSTANTS = json.loads((REPO_ROOT / "data" / "schema" / "constants.json").read_text())
