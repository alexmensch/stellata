#!/usr/bin/env python3
"""Build ``public/binaries.bin`` — one record per physical binary
pair for the runtime layer. See scripts/binaries/README.md
§ Files in this area."""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

SCRIPT = Path(__file__).resolve()
# Direct execution puts this folder on sys.path, not the repo root;
# add the root so the absolute ``scripts.*`` imports below resolve.
sys.path.insert(0, str(SCRIPT.parents[2]))

from scripts.refresh.refresh_lib import is_up_to_date  # noqa: E402
from scripts.util.astronomy_constants import J2000_JD  # noqa: E402
from scripts.binaries.component_tokens import (  # noqa: E402
    compound_contains,
    expand_wds_truncated_secondary,
    parent_component_token,
    related_hier,
)
from scripts.util.paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
SRC_MULTIPLES = ROOT / "data" / "binaries" / "multiples.tsv"
SRC_ROW_INDEX_MAP = ROOT / "public" / "catalog-row-index-map.json"
OUT_BIN = ROOT / "public" / "binaries.bin"
EXPECTED_COUNTS = SCRIPT.parent / "build-runtime-binaries-expected.json"

UPDATE_COUNTS_ENV_VAR = "UPDATE_BUILD_COUNTS"


# ─── Binary format ──────────────────────────────────────────────────


MAGIC = b"BIN1"
VERSION = 1
HEADER_SIZE = 16
RECORD_SIZE = 72

# Record field offsets. Layout chosen so the float64 fields land on
# 8-byte boundaries for DataView happiness on alignment-strict
# platforms. Trailing 8 bytes are reserved for forward-compat (a
# future stellar-mass field or per-relation perf-hud bookkeeping)
# without bumping VERSION.
RECORD_LAYOUT = {
    "primary_idx": 0,       # uint32
    "secondary_idx": 4,     # uint32
    "flags": 8,             # uint32 (bits 0..2 used; 3..31 reserved)
    "parent_relation": 12,  # int32 (-1 for outer / top-level pairs)
    "P_days": 16,           # float64
    "T_jd": 24,             # float64
    "e": 32,                # float32
    "a_AU": 36,             # float32
    "i_rad": 40,            # float32 (NaN when has_inclination=0)
    "omega_rad": 44,        # float32
    "Omega_rad": 48,        # float32
    "q": 52,                # float32
    "sep_arcsec": 56,       # float32
    "pa_deg": 60,           # float32
    "sep_pa_epoch_jd": 64,  # float32 (JD - J2000_JD; loader adds J2000 back)
    # bytes 68..71 reserved
}

FLAG_HAS_ORBIT = 0x1
FLAG_HAS_INCLINATION = 0x2
FLAG_IS_INNER_OF_HIERARCHY = 0x4

NO_PARENT = -1


# ─── Inputs ─────────────────────────────────────────────────────────


@dataclass
class MultiplesPair:
    """One physical pair, primary + secondary rows joined by system_id.
    See ``scripts/binaries/README.md`` § Runtime side artifact for the
    raw-comp synth-key invariant ``primary_comp`` / ``secondary_comp``
    encode."""

    system_id: str
    wds_id: str          # everything left of the final "-"
    components: str       # everything right of the final "-"
    primary_comp: str    # canonical primary comp (WDS-anchored)
    secondary_comp: str  # canonical secondary comp (WDS-anchored)
    primary_gaia: str | None
    primary_hip: int | None
    secondary_gaia: str | None
    secondary_hip: int | None
    P_days: float | None
    T_jd: float | None
    e: float | None
    a_AU: float | None
    i_rad: float | None
    omega_rad: float | None
    Omega_rad: float | None
    q: float | None
    sep_arcsec: float | None
    pa_deg: float | None
    sep_pa_epoch_jd: float | None


def _parse_float(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(s: str) -> int | None:
    s = s.strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _parse_gaia(s: str) -> str | None:
    s = s.strip()
    if not s or not s.isdigit():
        return None
    return s


def _canonical_comp_pair(
    primary_comp: str, secondary_comp: str,
) -> tuple[str, str]:
    """Re-anchor WDS prefix-truncation on the secondary comp cell.
    Mirrors `canonicalCompLetter` in companion-promotion.ts so the
    synth keys composed on the catalog and runtime sides match."""
    pri = primary_comp.strip()
    return pri, expand_wds_truncated_secondary(pri, secondary_comp.strip())


def load_pairs(path: Path) -> list[MultiplesPair]:
    """Read multiples.tsv and group primary+secondary rows into
    ``MultiplesPair`` records. Standalone rows are skipped — they aren't
    sides of a WDS pair. A pair where the primary or secondary row is
    missing or where the system_id has no dash is silently skipped (an
    orphan row indicates upstream skew, not data needing emission).
    """
    with path.open() as fh:
        header = fh.readline().rstrip("\n").split("\t")
        idx = {name: header.index(name) for name in header}
        primary_rows: dict[str, list[str]] = {}
        secondary_rows: dict[str, list[str]] = {}
        for line in fh:
            cells = line.rstrip("\n").split("\t")
            if len(cells) < len(header):
                continue
            role = cells[idx["orbit_role"]]
            sys_id = cells[idx["system_id"]]
            if role == "primary":
                primary_rows[sys_id] = cells
            elif role == "secondary":
                secondary_rows[sys_id] = cells

    pairs: list[MultiplesPair] = []
    for sys_id, p in primary_rows.items():
        s = secondary_rows.get(sys_id)
        if s is None:
            continue
        if "-" not in sys_id:
            continue
        # system_id is "<wds_id>-<components>"; split on the LAST dash
        # so WDS-style negative-Dec system_ids like "12345-1234-AB" still
        # split into ("12345-1234", "AB").
        dash = sys_id.rfind("-")
        wds_id = sys_id[:dash]
        components = sys_id[dash + 1:]
        raw_primary_comp = p[idx["comp"]].strip()
        raw_secondary_comp = s[idx["comp"]].strip()
        primary_comp, secondary_comp = _canonical_comp_pair(
            raw_primary_comp, raw_secondary_comp,
        )
        pairs.append(MultiplesPair(
            system_id=sys_id,
            wds_id=wds_id,
            components=components,
            primary_comp=primary_comp,
            secondary_comp=secondary_comp,
            primary_gaia=_parse_gaia(p[idx["gaia_source_id"]]),
            primary_hip=_parse_int(p[idx["hip"]]),
            secondary_gaia=_parse_gaia(s[idx["gaia_source_id"]]),
            secondary_hip=_parse_int(s[idx["hip"]]),
            P_days=_parse_float(p[idx["P_days"]]),
            T_jd=_parse_float(p[idx["T_jd"]]),
            e=_parse_float(p[idx["e"]]),
            a_AU=_parse_float(p[idx["a_AU"]]),
            i_rad=_parse_float(p[idx["i_rad"]]),
            omega_rad=_parse_float(p[idx["omega_rad"]]),
            Omega_rad=_parse_float(p[idx["Omega_rad"]]),
            q=_parse_float(p[idx["q"]]),
            sep_arcsec=_parse_float(p[idx["sep_arcsec"]]),
            pa_deg=_parse_float(p[idx["pa_deg"]]),
            sep_pa_epoch_jd=_parse_float(p[idx["sep_pa_epoch_jd"]]),
        ))
    return pairs


@dataclass
class RowIndexMap:
    """``public/catalog-row-index-map.json`` loaded into resolver maps."""

    by_gaia: dict[str, int]
    by_hip: dict[int, int]
    by_synth: dict[str, int]


def load_row_index_map(path: Path) -> RowIndexMap:
    raw = json.loads(path.read_text())
    by_gaia: dict[str, int] = dict(raw.get("byGaia", {}))
    by_hip: dict[int, int] = {int(k): v for k, v in raw.get("byHip", {}).items()}
    by_synth: dict[str, int] = dict(raw.get("bySynth", {}))
    return RowIndexMap(by_gaia=by_gaia, by_hip=by_hip, by_synth=by_synth)


def synthetic_id(wds_id: str, comp: str) -> str | None:
    """Compose ``synth-<wds_id>-<comp>``; ``None`` when either is empty."""
    c = comp.strip()
    if not c or not wds_id:
        return None
    return f"synth-{wds_id}-{c}"


def resolve_idx(
    gaia: str | None,
    hip: int | None,
    synth_key: str | None,
    m: RowIndexMap,
) -> int | None:
    """Catalog row resolution: gaia → hip → synth in priority order."""
    if gaia is not None:
        hit = m.by_gaia.get(gaia)
        if hit is not None:
            return hit
    if hip is not None:
        hit = m.by_hip.get(hip)
        if hit is not None:
            return hit
    if synth_key is not None:
        return m.by_synth.get(synth_key)
    return None


def synth_slot(
    synth_key: str | None,
    m: RowIndexMap,
    exclude: int | None = None,
) -> int | None:
    """The catalog row a component's synth key addresses, or None when no
    synth record exists or it aliases ``exclude``. Promotion mints a synth
    record only for a component whose gaia/hip were inherited then stripped,
    so a hit is the truer slot than an id-first resolve that blended onto the
    system anchor."""
    if synth_key is None:
        return None
    hit = m.by_synth.get(synth_key)
    return None if hit is None or hit == exclude else hit


def pair_has_orbit(p: MultiplesPair) -> bool:
    """True when every element BinaryOrbitField consumes (P, T, e, a, ω, q)
    is present and usable (P > 0 — Kepler eval divides by P) — the same
    gate `write_binary` stamps into FLAG_HAS_ORBIT. Also the "is this
    pair bound?" signal parent selection ranks on."""
    return (
        p.P_days is not None and p.P_days > 0 and p.T_jd is not None
        and p.e is not None and p.a_AU is not None
        and p.omega_rad is not None and p.q is not None
    )


# ─── Hierarchical-chain detection ───────────────────────────────────


# Component-letter tokens for WDS hierarchical naming:
#   "A" / "B" / "C" / "Aa" / "Ab" / "Aa1" / "Aa2" / "Ba1" / ...
# A token's PREFIX gives its parent component — "Aa" sits inside "A",
# "Aa1" sits inside "Aa". For pairs whose components string is
# "Aa1,Aa2" (or its WDS-truncated form "Aa1,2"), the parent pair is the
# one whose primary's letters spell "Aa" or whose secondary's letters do.


def _split_components(s: str) -> tuple[str, str] | None:
    """``"AB" → ("A", "B")``; ``"Aa,Ab" → ("Aa", "Ab")``; WDS-truncated
    ``"Aa1,2" → ("Aa1", "Aa2")`` (the ``2`` re-anchors to the primary's
    stem via ``expand_wds_truncated_secondary``). Returns ``None`` for
    component strings the splitter doesn't recognise."""
    if "," in s:
        parts = s.split(",")
        if len(parts) != 2:
            return None
        primary, secondary = parts[0], parts[1]
        return primary, expand_wds_truncated_secondary(primary, secondary)
    if len(s) == 2 and s.isalpha():
        return s[0], s[1]
    return None


# Test surface kept under the historical name; the implementation is
# shared with the pipeline's subdivision pass.
_parent_token = parent_component_token


def _parent_rank(p: MultiplesPair) -> tuple[int, float]:
    """Rank a candidate parent pair: the one that actually perturbs the
    shared component wins. Bound (has-orbit) pairs sort ahead of
    element-less wide pairs; ties break to the tightest separation. A
    component can list in several system pairs (Castor A is in AB, AC) —
    the inner pair must nest under the pair whose orbit its shared slot
    inherits (AB), not a coincidental wide pair (AC) that never moves it."""
    sep = p.sep_arcsec if p.sep_arcsec is not None else float("inf")
    return (0 if pair_has_orbit(p) else 1, sep)


def assign_parent_relations(pairs: list[MultiplesPair]) -> list[int]:
    """For each pair, return the index of its parent pair (the outer
    pair whose primary or secondary letter equals the inner pair's
    parent token), or ``NO_PARENT`` when the pair is top-level."""
    # Index pairs in the SAME wds_id system by component token. A token
    # can appear in several pairs, so each maps to a candidate LIST;
    # `_parent_rank` picks the bound one at lookup time.
    by_system_tokens: dict[str, dict[str, list[int]]] = {}
    pair_tokens: list[tuple[str, str] | None] = []
    for i, p in enumerate(pairs):
        toks = _split_components(p.components)
        pair_tokens.append(toks)
        if toks is None:
            continue
        bucket = by_system_tokens.setdefault(p.wds_id, {})
        bucket.setdefault(toks[0], []).append(i)  # primary token → pairs
        bucket.setdefault(toks[1], []).append(i)  # secondary token → pairs

    out: list[int] = []
    for i, p in enumerate(pairs):
        toks = pair_tokens[i]
        if toks is None:
            out.append(NO_PARENT)
            continue
        # The inner pair's parent is the system pair that lists this
        # inner pair's primary token's PARENT (one character shorter)
        # as one of its component letters. Algol Aa1,Aa2 → parent token
        # "Aa" → outer pair Aa,Ab carries "Aa" as its primary letter.
        parent_tok = _parent_token(toks[0])
        if parent_tok is None:
            out.append(NO_PARENT)
            continue
        bucket = by_system_tokens.get(p.wds_id)
        if bucket is None:
            out.append(NO_PARENT)
            continue
        candidates = [j for j in bucket.get(parent_tok, ()) if j != i]
        if not candidates:
            out.append(NO_PARENT)
            continue
        out.append(min(candidates, key=lambda j: _parent_rank(pairs[j])))
    return out


def topological_walk_order(parents: list[int]) -> list[int]:
    """Emit indices in outer-before-inner order so the runtime walk
    sees parents before children. Pairs with NO_PARENT come first
    (preserving their relative input order); each inner pair appears
    after its parent. Pure — no I/O."""
    children: dict[int, list[int]] = {}
    for i, p in enumerate(parents):
        if p == NO_PARENT:
            continue
        children.setdefault(p, []).append(i)
    order: list[int] = []
    visited = [False] * len(parents)

    def visit(i: int) -> None:
        if visited[i]:
            return
        visited[i] = True
        order.append(i)
        for c in children.get(i, []):
            visit(c)

    for i, p in enumerate(parents):
        if p == NO_PARENT:
            visit(i)
    for i in range(len(parents)):  # orphans with broken parent links
        if not visited[i]:
            visit(i)
    return order


def override_inner_primary_indices(
    pairs: list[MultiplesPair],
    parents: list[int],
    walk_order: list[int],
    resolved_primary: list[int | None],
    resolved_secondary: list[int | None],
) -> None:
    """Force each inner pair's primary onto its parent component's catalog
    slot — the shared-slot invariant the runtime walk + focal-frame ride
    both depend on (see src/client/binaries/README.md § Hierarchical walk).

    An inner pair's own id-first resolve can miss this slot when the
    parent component is Gaia-blended with the system primary: Castor Ba
    carries A's shared source_id, so it resolves to A's row (98630)
    instead of B's synth row (179304). The parent pair (AB) already
    resolved B correctly via the secondary-collapse retry, so re-home the
    inner primary onto that member. Applied in topological order so a
    deeper nest inherits its parent's already-corrected slot. Mutates
    ``resolved_primary`` in place."""
    for i in walk_order:
        parent_i = parents[i]
        if parent_i == NO_PARENT:
            continue
        parent_tok = _parent_token(pairs[i].primary_comp)
        if parent_tok is None:
            continue
        pp = pairs[parent_i]
        if pp.primary_comp == parent_tok:
            slot = resolved_primary[parent_i]
        elif pp.secondary_comp == parent_tok:
            slot = resolved_secondary[parent_i]
        else:
            continue
        if slot is not None:
            resolved_primary[i] = slot


# ─── Binary writer ──────────────────────────────────────────────────


def _f32(v: float | None) -> float:
    """Encode a missing-element float as NaN. NaN survives the
    DataView round-trip and is the loader's "absent" sentinel."""
    return float("nan") if v is None else float(v)


def _f64(v: float | None) -> float:
    return float("nan") if v is None else float(v)


def same_relation_alias(a: MultiplesPair, b: MultiplesPair) -> bool:
    """True when two pairs colliding on one (primaryIdx, secondaryIdx)
    relation are the SAME physical link named at different granularity —
    on each side the two comp tokens are equal, hierarchy-related
    (``A``/``Aa``), or compound-contained (``AB``/``A``). Dropping one is
    a correct, permanent dedup (18025+4414 ``AB`` vs ``Aa,B``). Disjoint
    letters on either side mean two DISTINCT stars collapsed onto one
    record — a real collapse the ratchet tracks (θ¹ Ori ``Bb,Bc`` vs
    ``Ba,Bc`` on the Ba/Bb blend)."""
    def alias(x: str, y: str) -> bool:
        return related_hier(x, y) or compound_contains(x, y)
    return (
        alias(a.primary_comp, b.primary_comp)
        and alias(a.secondary_comp, b.secondary_comp)
    )


@dataclass
class WriteStats:
    pairs_total: int
    pairs_emitted: int
    pairs_dropped_primary_unresolved: int
    pairs_dropped_secondary_unresolved: int
    pairs_dropped_degenerate_idx: int
    pairs_dropped_same_relation_alias: int
    pairs_dropped_duplicate_relation: int
    pairs_with_orbit: int
    pairs_with_inclination: int
    pairs_inner_of_hierarchy: int


def write_binary(
    pairs: list[MultiplesPair],
    parents: list[int],
    walk_order: list[int],
    row_map: RowIndexMap,
    out_path: Path,
) -> WriteStats:
    """Resolve primary/secondary catalog row indices, encode each pair,
    and write header + records in topological-walk order. The
    parent_relation indices stored on each inner record refer to the
    pair's position in the EMITTED order, not the input order."""
    # Pre-resolve every pair so we know which ones are emittable. Pairs
    # whose primary or secondary doesn't resolve to a catalog row are
    # dropped — the runtime layer can't address them.
    resolved_primary: list[int | None] = []
    resolved_secondary: list[int | None] = []
    for p in pairs:
        primary_synth = synthetic_id(p.wds_id, p.primary_comp)
        secondary_synth = synthetic_id(p.wds_id, p.secondary_comp)
        pri = resolve_idx(p.primary_gaia, p.primary_hip, primary_synth, row_map)
        sec = resolve_idx(p.secondary_gaia, p.secondary_hip, secondary_synth, row_map)
        # Blended-sibling retry, both ends. A blended component carries
        # another member's gaia/hip (photocentre or pair-mate inheritance),
        # so its id-first resolve lands on that member's row; promotion
        # mints a synth slot only after judging the row's ids inherited and
        # stripping them, so a distinct synth slot is ALWAYS the truer
        # target. Both ends retry unconditionally, excluding their own
        # id-first resolve (04049-3527 BC's C carries A's source as an AC
        # pair-mate — not the primary's — and still re-homes onto synth-C).
        # Inner-pair primaries are re-homed onto their parent slot afterward
        # by override_inner_primary_indices, so this only decides wide pairs.
        if sec is not None:
            hit = synth_slot(secondary_synth, row_map, exclude=sec)
            if hit is not None:
                sec = hit
        if pri is not None:
            hit = synth_slot(primary_synth, row_map, exclude=pri)
            if hit is not None:
                pri = hit
        resolved_primary.append(pri)
        resolved_secondary.append(sec)

    override_inner_primary_indices(
        pairs, parents, walk_order, resolved_primary, resolved_secondary,
    )

    # Pick one record per (primary, secondary) relation. A blended non-anchor
    # primary can collapse a distinct pair onto an existing relation; keep the
    # orbit-bearing member so live motion is not dropped in favour of an
    # element-less wide pair. Ties keep the first in walk order.
    relation_winner: dict[tuple[int, int], int] = {}
    for i in walk_order:
        if resolved_primary[i] is None or resolved_secondary[i] is None:
            continue
        if resolved_primary[i] == resolved_secondary[i]:
            continue
        rel_key = (resolved_primary[i], resolved_secondary[i])
        incumbent = relation_winner.get(rel_key)
        if incumbent is None or (
            pair_has_orbit(pairs[i]) and not pair_has_orbit(pairs[incumbent])
        ):
            relation_winner[rel_key] = i

    emit_indices: list[int] = []
    input_to_output: dict[int, int] = {}
    stats = WriteStats(
        pairs_total=len(pairs),
        pairs_emitted=0,
        pairs_dropped_primary_unresolved=0,
        pairs_dropped_secondary_unresolved=0,
        pairs_dropped_degenerate_idx=0,
        pairs_dropped_same_relation_alias=0,
        pairs_dropped_duplicate_relation=0,
        pairs_with_orbit=0,
        pairs_with_inclination=0,
        pairs_inner_of_hierarchy=0,
    )
    # Walk in topological order; for each emittable pair, record its output
    # index so parent_relation can be remapped from input-index to output-index.
    for i in walk_order:
        if resolved_primary[i] is None:
            stats.pairs_dropped_primary_unresolved += 1
            continue
        if resolved_secondary[i] is None:
            stats.pairs_dropped_secondary_unresolved += 1
            continue
        if resolved_primary[i] == resolved_secondary[i]:
            # Primary and secondary must map to distinct catalog rows —
            # the runtime walks them as independent slots and can't
            # perturb two pair ends through one. Pairs whose secondary
            # shares the primary's gaia/hip cross-walk collapse to a
            # self-referencing entry; drop them here.
            stats.pairs_dropped_degenerate_idx += 1
            continue
        rel_key = (resolved_primary[i], resolved_secondary[i])
        if relation_winner[rel_key] != i:
            # Exact (primary, secondary) duplicate. Emit only the chosen
            # winner (orbit-bearing preferred above) so no relation appears
            # twice on a hover card, and classify the drop: an ALIAS names
            # the same physical link twice (accepted-permanent); disjoint
            # comp letters are a real collapse of two distinct stars onto
            # one record (ratchet — each is a missing minted slot).
            if same_relation_alias(pairs[i], pairs[relation_winner[rel_key]]):
                stats.pairs_dropped_same_relation_alias += 1
            else:
                stats.pairs_dropped_duplicate_relation += 1
            continue
        input_to_output[i] = len(emit_indices)
        emit_indices.append(i)

    stats.pairs_emitted = len(emit_indices)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with out_path.open("wb") as fh:
        # Header: magic + version + count + 4 bytes reserved.
        fh.write(MAGIC)
        fh.write(struct.pack("<II", VERSION, stats.pairs_emitted))
        fh.write(b"\x00" * 4)

        for input_i in emit_indices:
            p = pairs[input_i]
            primary_idx = resolved_primary[input_i]
            secondary_idx = resolved_secondary[input_i]
            assert primary_idx is not None and secondary_idx is not None

            # has_orbit gates per-frame Kepler eval in BinaryOrbitField:
            # every element it consumes must be present, else ΔR(t) is NaN
            # and the runtime writes NaN into localPositions[primaryIdx]
            # every frame — silently corrupting every consumer of the
            # primary's position, including projection and the chart-label
            # magnitude gate, where a NaN loses every comparison instead of
            # failing.
            has_orbit = pair_has_orbit(p)
            has_inclination = has_orbit and p.i_rad is not None
            parent_input = parents[input_i]
            parent_output = input_to_output.get(parent_input, NO_PARENT)
            is_inner = parent_output != NO_PARENT

            flags = 0
            if has_orbit:
                flags |= FLAG_HAS_ORBIT
                stats.pairs_with_orbit += 1
            if has_inclination:
                flags |= FLAG_HAS_INCLINATION
                stats.pairs_with_inclination += 1
            if is_inner:
                flags |= FLAG_IS_INNER_OF_HIERARCHY
                stats.pairs_inner_of_hierarchy += 1

            buf = bytearray(RECORD_SIZE)
            struct.pack_into("<I", buf, RECORD_LAYOUT["primary_idx"], primary_idx)
            struct.pack_into("<I", buf, RECORD_LAYOUT["secondary_idx"], secondary_idx)
            struct.pack_into("<I", buf, RECORD_LAYOUT["flags"], flags)
            struct.pack_into("<i", buf, RECORD_LAYOUT["parent_relation"], parent_output)
            struct.pack_into("<d", buf, RECORD_LAYOUT["P_days"], _f64(p.P_days))
            struct.pack_into("<d", buf, RECORD_LAYOUT["T_jd"], _f64(p.T_jd))
            struct.pack_into("<f", buf, RECORD_LAYOUT["e"], _f32(p.e))
            struct.pack_into("<f", buf, RECORD_LAYOUT["a_AU"], _f32(p.a_AU))
            struct.pack_into("<f", buf, RECORD_LAYOUT["i_rad"], _f32(p.i_rad))
            struct.pack_into("<f", buf, RECORD_LAYOUT["omega_rad"], _f32(p.omega_rad))
            struct.pack_into("<f", buf, RECORD_LAYOUT["Omega_rad"], _f32(p.Omega_rad))
            struct.pack_into("<f", buf, RECORD_LAYOUT["q"], _f32(p.q))
            struct.pack_into("<f", buf, RECORD_LAYOUT["sep_arcsec"], _f32(p.sep_arcsec))
            struct.pack_into("<f", buf, RECORD_LAYOUT["pa_deg"], _f32(p.pa_deg))
            epoch_offset = (
                p.sep_pa_epoch_jd - J2000_JD if p.sep_pa_epoch_jd is not None else None
            )
            struct.pack_into("<f", buf, RECORD_LAYOUT["sep_pa_epoch_jd"], _f32(epoch_offset))
            fh.write(buf)

    return stats


def stats_to_counts(stats: WriteStats) -> dict[str, int]:
    return {
        "pairs_total": stats.pairs_total,
        "pairs_emitted": stats.pairs_emitted,
        "pairs_dropped_primary_unresolved": stats.pairs_dropped_primary_unresolved,
        "pairs_dropped_secondary_unresolved": stats.pairs_dropped_secondary_unresolved,
        "pairs_dropped_degenerate_idx": stats.pairs_dropped_degenerate_idx,
        "pairs_dropped_same_relation_alias": stats.pairs_dropped_same_relation_alias,
        "pairs_dropped_duplicate_relation": stats.pairs_dropped_duplicate_relation,
        "pairs_with_orbit": stats.pairs_with_orbit,
        "pairs_with_inclination": stats.pairs_with_inclination,
        "pairs_inner_of_hierarchy": stats.pairs_inner_of_hierarchy,
    }


def assert_or_update_counts(actual: dict[str, int], expected_path: Path) -> bool:
    should_update = os.environ.get(UPDATE_COUNTS_ENV_VAR) == "1"
    if should_update or not expected_path.exists():
        expected_path.write_text(json.dumps(actual, indent=2) + "\n")
        try:
            shown = expected_path.relative_to(ROOT)
        except ValueError:
            shown = expected_path
        log(f"{'Updated' if should_update else 'Wrote initial'} {shown}")
        return True
    expected = json.loads(expected_path.read_text())
    drift = [(k, expected.get(k), actual.get(k)) for k in sorted(expected.keys() | actual.keys())
             if expected.get(k) != actual.get(k)]
    if not drift:
        log(f"build-runtime-binaries counts: all {len(actual)} counts match")
        return True
    log(
        f"build-runtime-binaries counts: {len(drift)} of {len(actual)} differ",
    )
    for k, e, a in drift:
        delta = (a or 0) - (e or 0)
        sign = "+" if delta > 0 else ""
        log(f"  {k:<40} expected {e}, got {a} ({sign}{delta})")
    return False


# ─── Driver ─────────────────────────────────────────────────────────


def log(msg: str) -> None:
    print(f"[build-runtime-binaries] {msg}")


def _iter_input_paths() -> Iterator[Path]:
    # Writer logic spans the sibling modules (component_tokens et al.)
    # and scripts/util, not just this file.
    for folder in (SCRIPT.parent, SCRIPT.parent.parent / "util"):
        for mod in sorted(folder.glob("*.py")):
            if not mod.name.endswith(".test.py"):
                yield mod
    yield SRC_MULTIPLES
    yield SRC_ROW_INDEX_MAP


def run(force: bool) -> int:
    if not SRC_MULTIPLES.exists():
        log(f"missing {SRC_MULTIPLES.relative_to(ROOT)} — run pnpm run build:binaries first")
        return 1
    if not SRC_ROW_INDEX_MAP.exists():
        log(
            f"missing {SRC_ROW_INDEX_MAP.relative_to(ROOT)} — run "
            "pnpm run build:catalog first",
        )
        return 1
    if not force and OUT_BIN.exists() and is_up_to_date(OUT_BIN, _iter_input_paths()):
        log(
            f"{OUT_BIN.relative_to(ROOT)} up to date — skipping "
            "(use --force to rebuild)"
        )
        return 0

    log(f"loading {SRC_MULTIPLES.relative_to(ROOT)} …")
    pairs = load_pairs(SRC_MULTIPLES)
    log(f"loaded {len(pairs):,} physical pair relations")

    log(f"loading {SRC_ROW_INDEX_MAP.relative_to(ROOT)} …")
    row_map = load_row_index_map(SRC_ROW_INDEX_MAP)
    log(
        f"loaded row-index map: {len(row_map.by_gaia):,} Gaia entries, "
        f"{len(row_map.by_hip):,} HIP entries, "
        f"{len(row_map.by_synth):,} synthetic entries"
    )

    parents = assign_parent_relations(pairs)
    n_inner = sum(1 for x in parents if x != NO_PARENT)
    log(f"hierarchical chain: {n_inner:,} inner pairs nested inside outer pairs")

    walk_order = topological_walk_order(parents)

    stats = write_binary(pairs, parents, walk_order, row_map, OUT_BIN)
    size_kb = OUT_BIN.stat().st_size / 1024
    log(
        f"wrote {OUT_BIN.relative_to(ROOT)} ({stats.pairs_emitted:,} pairs, "
        f"{size_kb:.1f} KB)"
    )
    log(
        f"orbit coverage: {stats.pairs_with_orbit:,} with elements "
        f"({stats.pairs_with_inclination:,} with inclination)"
    )
    log(
        f"dropped: primary_unresolved={stats.pairs_dropped_primary_unresolved}, "
        f"secondary_unresolved={stats.pairs_dropped_secondary_unresolved}, "
        f"degenerate_idx={stats.pairs_dropped_degenerate_idx}, "
        f"same_relation_alias={stats.pairs_dropped_same_relation_alias}, "
        f"duplicate_relation={stats.pairs_dropped_duplicate_relation}"
    )

    if not assert_or_update_counts(stats_to_counts(stats), EXPECTED_COUNTS):
        log(
            f"counts assertion failed. If intentional, refresh with: "
            f"{UPDATE_COUNTS_ENV_VAR}=1 pnpm run build:binaries-runtime"
        )
        return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--force", action="store_true",
        help="ignore mtime check and rebuild",
    )
    args = p.parse_args()
    return run(force=args.force)


if __name__ == "__main__":
    sys.exit(main())
