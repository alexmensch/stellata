#!/usr/bin/env python3
"""WDS component-letter token helpers shared by the pipeline stages and
the runtime-binaries writer."""

from __future__ import annotations

import re

# Canonical single-component token grammar: "A", "Aa", "Aa1". Compound
# tokens ("AB", "BC") and deeper forms fail — pairs built from those
# sides can't participate in the letter hierarchy.
_COMPONENT_TOKEN_RE = re.compile(r"^[A-Z][a-z]?\d?$")


def is_component_token(tok: str) -> bool:
    return bool(_COMPONENT_TOKEN_RE.match(tok))


def expand_wds_truncated_secondary(primary: str, secondary: str) -> str:
    """Re-anchor WDS prefix truncation: ``("Aa1", "2") → "Aa2"``. WDS
    (and multiples.tsv, which keeps the raw comp form) stores the
    secondary as a bare digit when it shares the primary's stem.
    Non-truncated secondaries pass through unchanged."""
    if (
        secondary and secondary.isdigit()
        and len(primary) >= 2 and primary[-1].isdigit()
    ):
        return primary[:-1] + secondary
    return secondary


def parent_component_token(tok: str) -> str | None:
    """``"Aa1" → "Aa"``; ``"Aa" → "A"``; ``"A" → None``. The parent is
    the component string with its rightmost designator dropped."""
    if len(tok) <= 1:
        return None
    return tok[:-1]


def child_component_tokens(tok: str) -> tuple[str, str] | None:
    """Sub-pair component names one level below ``tok``:
    ``"A" → ("Aa", "Ab")``; ``"Aa" → ("Aa1", "Aa2")``. Returns ``None``
    for digit-bearing tokens (no WDS convention exists below "Aa1") and
    for compound / non-token forms."""
    if re.fullmatch(r"[A-Z]", tok):
        return tok + "a", tok + "b"
    if re.fullmatch(r"[A-Z][a-z]", tok):
        return tok + "1", tok + "2"
    return None
