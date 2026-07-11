#!/usr/bin/env python3
"""MSC hierarchy-label → WDS component-token mapping + MSC lookup
tables for Stages 2/4/6. Label convention: data/msc/README.md."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import (  # noqa: E402
    MscComponentRow, MscOrbitRow, MscSystemRow,
)
from component_tokens import (  # noqa: E402
    child_component_tokens,
    is_component_token,
    token_letters,
)


# ``parent`` values that mean "no enclosing component": ``*`` is the
# system root; ``t`` and ``X`` mark non-hierarchical / unattributed
# ties whose sides carry WDS-consistent labels directly.
MSC_ROOT_PARENT_LABELS: frozenset[str] = frozenset({"*", "t", "X", ""})


def _is_wds_shaped(label: str) -> bool:
    """True for labels that ARE valid WDS tokens as-is: canonical
    single-component tokens (``A``, ``Aa``, ``Aa1``) and all-caps
    compounds (``AB``, ``BC``). Union labels like ``Aab`` fail."""
    return bool(label) and (
        is_component_token(label)
        or (len(label) >= 2 and label.isalpha() and label.isupper())
    )


def map_msc_labels(pair_rows: list[MscSystemRow]) -> dict[str, str]:
    """One system's MSC label → WDS token map, walked top-down.

    Root-level sides map identity (MSC follows WDS at the top level).
    A pair subdividing a mapped component takes that component's WDS
    child tokens positionally (``Aab,Ac`` under ``A`` → ``Aa,Ab``;
    ``Aa,Ab`` under ``Aab``→``Aa`` → ``Aa1,Aa2``), which reduces to
    identity when MSC's labels already follow the WDS convention. A
    pair subdividing a compound maps its sides identity when they are
    the compound's own constituents (``A,B`` under ``AB``). Sides that
    fit no rule stay unmapped, and their subtrees with them.
    """
    mapping: dict[str, str] = {}
    pending = list(pair_rows)
    while pending:
        remaining: list[MscSystemRow] = []
        progressed = False
        for row in pending:
            parent = row.parent
            if parent in MSC_ROOT_PARENT_LABELS:
                for side in (row.prim, row.sec):
                    if _is_wds_shaped(side):
                        mapping.setdefault(side, side)
            elif parent in mapping:
                base = mapping[parent]
                if is_component_token(base):
                    children = child_component_tokens(base)
                    if children is not None:
                        mapping.setdefault(row.prim, children[0])
                        mapping.setdefault(row.sec, children[1])
                else:
                    base_letters = token_letters(base)
                    for side in (row.prim, row.sec):
                        if (
                            _is_wds_shaped(side)
                            and token_letters(side) <= base_letters
                        ):
                            mapping.setdefault(side, side)
            else:
                remaining.append(row)
                continue
            progressed = True
        if not progressed:
            break
        pending = remaining
    return mapping


@dataclass
class MscLookup:
    """WDS-token-keyed MSC lookup tables. Pair keys are ordered
    ``(primary_token, secondary_token)`` matching the WDS pair's own
    decomposition order, so Stage 4/6 lookups join without re-sorting.
    """

    # (wds_id, (tok_pri, tok_sec)) → orbit rows (a pair can carry
    # several editions; stage4_orbits._pick_best_msc arbitrates).
    orbits_by_pair: dict[tuple[str, tuple[str, str]], list[MscOrbitRow]] = (
        field(default_factory=dict)
    )
    # (wds_id, (tok_pri, tok_sec)) → (vmag_pri, vmag_sec).
    pair_mags: dict[
        tuple[str, tuple[str, str]], tuple[float | None, float | None],
    ] = field(default_factory=dict)
    # (wds_id, token) → MK spectral type.
    spect_by_comp: dict[tuple[str, str], str] = field(default_factory=dict)
    n_orbits_unmapped: int = 0


def build_msc_lookup(
    systems: list[MscSystemRow],
    orbits: list[MscOrbitRow],
    components: list[MscComponentRow],
) -> MscLookup:
    """Map every MSC label to WDS tokens and key the orbit / photometry /
    spectral tables on them. Unmappable labels drop their rows
    (counted for the build log); the components table's top-level
    letters are WDS-consistent already and join by identity."""
    systems_by_wds: dict[str, list[MscSystemRow]] = {}
    for row in systems:
        systems_by_wds.setdefault(row.wds_id, []).append(row)
    label_maps: dict[str, dict[str, str]] = {
        wds_id: map_msc_labels(rows)
        for wds_id, rows in systems_by_wds.items()
    }

    out = MscLookup()

    for row in orbits:
        parts = row.syst.split(",")
        if len(parts) != 2:
            out.n_orbits_unmapped += 1
            continue
        label_map = label_maps.get(row.wds_id, {})
        tok_pri = label_map.get(parts[0].strip())
        tok_sec = label_map.get(parts[1].strip())
        if tok_pri is None or tok_sec is None or tok_pri == tok_sec:
            out.n_orbits_unmapped += 1
            continue
        out.orbits_by_pair.setdefault(
            (row.wds_id, (tok_pri, tok_sec)), [],
        ).append(row)

    for row in systems:
        label_map = label_maps.get(row.wds_id, {})
        tok_pri = label_map.get(row.prim)
        tok_sec = label_map.get(row.sec)
        if tok_pri is None or tok_sec is None:
            continue
        if row.vmag1 is not None or row.vmag2 is not None:
            out.pair_mags.setdefault(
                (row.wds_id, (tok_pri, tok_sec)), (row.vmag1, row.vmag2),
            )
        # Pair-side spectral types cover the subsystem members the
        # components table (top-level letters only) never lists —
        # compounds and union photocentres are skipped: a blend's type
        # belongs to no single component.
        for tok, spt in ((tok_pri, row.spt1), (tok_sec, row.spt2)):
            if spt and is_component_token(tok):
                out.spect_by_comp.setdefault((row.wds_id, tok), spt)

    # Components-table types win over pair-side types: measured per
    # component rather than read off a pair row.
    for comp_row in components:
        if comp_row.spt and is_component_token(comp_row.comp):
            out.spect_by_comp[(comp_row.wds_id, comp_row.comp)] = comp_row.spt

    return out
