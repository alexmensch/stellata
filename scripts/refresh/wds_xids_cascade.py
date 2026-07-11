"""Pure helpers for refresh-simbad-wds-xids.py: build HD/CCDM/HIP cascade
candidates from resolved-primary aliases, filter the batched ident-table
query result back into (wds_id, component) → oid, and resolve an oid's
HIP alias set (bare + per-component suffixed forms) to one HIP."""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence


# SIMBAD pads the HD-number column to width 7 right-aligned, so
# `f"HD{hd:>7d}"` reproduces the canonical 9-character `HD<pad><num>`
# block exactly — confirmed against `HD  48915` (Sirius), `HD   1202`,
# `HD 225220`, `HD    113`. Appending a component letter (uppercase from
# WDS, never coerced to lowercase) yields the per-component form SIMBAD
# stores. Lowercase `b/c/d` suffixes are reserved for exoplanets and
# never appear here.
HD_FIELD_WIDTH = 7


def build_cascade_candidates(
    unresolved_with_siblings: Iterable[tuple[str, str]],
    siblings_by_wds: Mapping[str, Sequence[tuple[str, int]]],
    hd_by_oid: Mapping[int, int],
    hip_by_oid: Mapping[int, int],
) -> tuple[list[str], dict[str, tuple[str, str, str]]]:
    """Construct cascade alias candidates per unresolved (wds_id, comp).

    Returns (candidates, cand_to_key) where candidates is a deduped
    sorted list of distinct SIMBAD ident strings to query, and cand_to_key
    maps each candidate back to (wds_id, comp, strategy) for result
    attribution. `strategy` ∈ {"HD", "CCDM", "HIP"} — used for logging
    and validates which catalog path produced the recovery.

    Per-(wds_id, comp) candidate construction:
      - CCDM uses the WDS positional anchor directly (CCDM and WDS share
        coordinate-epoch conventions for the J2000 positional id).
      - HD/HIP come from siblings — any resolved sibling under the same
        wds_id contributes its HD/HIP alias as a candidate. Different
        siblings may map to the same HD (single-star system) or
        different HDs (rare multi-HD systems); both produce distinct
        candidates and the query disambiguates.
    """
    candidates: set[str] = set()
    cand_to_key: dict[str, tuple[str, str, str]] = {}

    def add(ident: str, key: tuple[str, str, str]) -> None:
        candidates.add(ident)
        # First strategy to claim an ident keeps attribution. Collisions
        # would only happen for unusual ident shapes — accept first-wins.
        cand_to_key.setdefault(ident, key)

    for wds_id, comp in unresolved_with_siblings:
        add(f"CCDM J{wds_id}{comp}", (wds_id, comp, "CCDM"))
        for _sib_comp, sib_oid in siblings_by_wds.get(wds_id, ()):
            hd = hd_by_oid.get(sib_oid)
            if hd is not None:
                add(f"HD{hd:>{HD_FIELD_WIDTH}d}{comp}", (wds_id, comp, "HD"))
            hip = hip_by_oid.get(sib_oid)
            if hip is not None:
                add(f"HIP {hip}{comp}", (wds_id, comp, "HIP"))
                add(f"HIP {hip} {comp}", (wds_id, comp, "HIP"))

    return sorted(candidates), cand_to_key


def filter_cascade_hits(
    rows: Iterable[Mapping[str, Any]],
    cand_to_key: Mapping[str, tuple[str, str, str]],
    resolved_oids: set[int],
) -> tuple[dict[tuple[str, str], int], dict[str, int]]:
    """Filter the cascade query result into a (wds_id, comp) → oid map.

    Returns (recoveries, strategy_hit_counts). A hit is dropped when:
      - the ident isn't in cand_to_key (defensive — shouldn't happen),
      - the oid is already in resolved_oids (alias points back to a
        Phase-A primary, not a new component),
      - the (wds_id, comp) is already in `recoveries` with a different
        oid (defensive — first-wins; multiple aliases for the same
        component should map to the same oid, but log mismatches).

    `strategy_hit_counts` counts raw alias-row hits per strategy
    (HD/CCDM/HIP) — used by the refresh script for diagnostic logging.
    Different strategies may attribute the same recovery; the count is
    informative, not summed against distinct recoveries.
    """
    recoveries: dict[tuple[str, str], int] = {}
    counts: dict[str, int] = {"HD": 0, "CCDM": 0, "HIP": 0}
    for row in rows:
        ident = str(row["id"])
        oid = int(row["oidref"])
        key = cand_to_key.get(ident)
        if key is None:
            continue
        wds_id, comp, strategy = key
        if oid in resolved_oids:
            continue
        existing = recoveries.get((wds_id, comp))
        if existing is not None and existing != oid:
            # Two aliases for the same (wds_id, comp) pointed at different
            # SIMBAD oids — keep the first-wins entry, skip the conflict.
            # Rare; would indicate a SIMBAD curation inconsistency.
            continue
        recoveries[(wds_id, comp)] = oid
        counts[strategy] += 1
    return recoveries, counts


def parse_hd_or_hip_from_ident(ident: str) -> tuple[str, int, str] | None:
    """Pure parser for an `HD<pad><num>[comp]` or `HIP <num>[comp]` ident.

    Returns (`"HD"` | `"HIP"`, integer, component-suffix) or None on
    parse failure. The suffix is `""` for the bare canonical form;
    SIMBAD stores per-component aliases both fused (`HIP 55203A`) and
    space-separated (`HIP 32349 B`).
    """
    if ident.startswith("HD "):
        prefix = "HD"
        body = ident[3:].strip()
    elif ident.startswith("HIP "):
        prefix = "HIP"
        body = ident[4:].strip()
    else:
        return None
    end = 0
    while end < len(body) and body[end].isdigit():
        end += 1
    if end == 0:
        return None
    return prefix, int(body[:end]), body[end:].strip()


def resolve_hip_from_aliases(
    candidates: Sequence[tuple[int, str]],
    component_letters: set[str],
) -> int | None:
    """Pick one HIP from an oid's HIP alias rows.

    `candidates` is (hip, suffix) per alias row, in result order. A
    bare-integer alias is SIMBAD's canonical form and wins. Otherwise a
    suffixed alias binds only when its suffix matches a component letter
    this oid resolved as (`HIP 55203A` on ξ UMa A — ORB6 attributes HIPs
    to primaries only, so without this the secondary never gets one);
    distinct HIPs whose suffixes both match are ambiguous and drop the
    binding entirely.
    """
    for hip, suffix in candidates:
        if not suffix:
            return hip
    matched = {hip for hip, suffix in candidates if suffix in component_letters}
    if len(matched) == 1:
        return matched.pop()
    return None
