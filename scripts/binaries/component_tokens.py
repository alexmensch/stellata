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


_UPPERCASE_LETTER_RE = re.compile(r"[A-Z]")


def token_letters(tok: str) -> frozenset[str]:
    """Uppercase component letters in a token: ``"AB" → {A, B}``,
    ``"Aa1" → {A}``. Used for the compound-containment relation."""
    return frozenset(_UPPERCASE_LETTER_RE.findall(tok))


def is_hier_ancestor(a: str, b: str) -> bool:
    """True when ``a`` is a strict ancestor of ``b`` in the WDS component
    hierarchy (``A`` ← ``Aa`` ← ``Aa1``). Defined only for canonical
    single-component tokens; compound tokens (``AB``) never enter the
    chain — their overlap is expressed by compound-containment instead."""
    if not is_component_token(a) or not is_component_token(b):
        return False
    cur = parent_component_token(b)
    while cur is not None:
        if cur == a:
            return True
        cur = parent_component_token(cur)
    return False


def related_hier(a: str, b: str) -> bool:
    """Equal, or one is an ancestor of the other."""
    return a == b or is_hier_ancestor(a, b) or is_hier_ancestor(b, a)


def compound_contains(a: str, b: str) -> bool:
    """One token is a multi-letter compound whose letters include the
    other's (``"AB"`` contains ``"A"`` and ``"Aa"``)."""
    la, lb = token_letters(a), token_letters(b)
    if len(la) >= 2 and lb and lb <= la:
        return True
    if len(lb) >= 2 and la and la <= lb:
        return True
    return False


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
