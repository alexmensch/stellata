"""Phase A.6 cascade for refresh-simbad-wds-xids.py — recover components
whose SIMBAD oid exists but isn't stored under `WDS J<id><comp>`.

Empirical motivation (2026-05-21 sweep, see dch.65 PR description): Phase
A's bare `WDS J<id><comp>` lookup hits 38% of WDS component tuples. Of
the unresolved residual, ~198 distinct (wds_id, comp) tuples ARE in
SIMBAD's ident table under a non-WDS-J alias keyed by either:
  - the system's HD number + component letter (`HD<padded><comp>`), or
  - the CCDM catalog's identifier at the same positional anchor as WDS
    (`CCDM J<wds_id><comp>`), or
  - the system's HIP number + component letter (`HIP <num><comp>` /
    `HIP <num> <comp>`), small yield.

Sirius B is the canonical case (recoverable via `HD  48915B`). The
cascade replaces what would otherwise be a hand-curated list — see the
dch.65 sweep section in the PR body for the recovery-rate breakdown and
the reason h_link hierarchy traversal was rejected (97% non-WDS noise).

The expensive impure step (`pull_primary_aliases`) batches one ADQL
query per ~1000 primary oids against SIMBAD's ident table; the cascade
candidate query is a single batched IN-clause sweep. The pure helpers
(`build_cascade_candidates`, `filter_cascade_hits`) are independently
testable.
"""

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


def parse_hd_or_hip_from_ident(ident: str) -> tuple[str, int] | None:
    """Pure parser for an `HD<pad><num>` or `HIP <num>` ident string.

    Returns (`"HD"` | `"HIP"`, integer) or None on parse failure.
    Strips trailing component suffix if present (caller never feeds those
    in — the script's `pull_primary_aliases` filter uses `LIKE 'HD %'`
    plus `LIKE 'HIP %'`, and component-suffixed forms like `HD 48915B`
    pass that filter too). Per-component aliases parse to the BASE
    integer, dropping the component letter — that's correct, since we
    use the base integer to compose `HD<num><comp>` candidates and the
    component-suffixed source ident shouldn't be a candidate for itself.
    """
    if ident.startswith("HD ") or ident.startswith("HD\t"):
        prefix = "HD"
        body = ident[3:].strip()
    elif ident.startswith("HIP "):
        prefix = "HIP"
        body = ident[4:].strip()
    else:
        return None
    # Strip any non-digit trailing characters (component letter, etc.).
    end = 0
    while end < len(body) and body[end].isdigit():
        end += 1
    if end == 0:
        return None
    try:
        return prefix, int(body[:end])
    except ValueError:
        return None
