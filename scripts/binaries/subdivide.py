#!/usr/bin/env python3
"""Synthesized sub-pair injection — inner pairs whose orbit exists in
ORB6 / Gaia NSS / Pulkovo MSC but which WDS never enumerates as a pair
row. See ``scripts/binaries/README.md`` § Sub-pair synthesis."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parsers import Orb6Entry, WdsPair  # noqa: E402
from indices import IdentifierIndices  # noqa: E402
from component_tokens import (  # noqa: E402
    child_component_tokens,
    expand_wds_truncated_secondary,
    is_component_token,
    parent_component_token,
    token_letters,
)
from msc_map import MscLookup  # noqa: E402
from stage2_resolve import (  # noqa: E402
    ResolvedComponent,
    build_pair_by_wds_disc,
    find_owning_pair,
    split_components,
)
from stage3_astrometry import ComponentAstrometry  # noqa: E402
from stage4_orbits import (  # noqa: E402
    _nss_in_regime,
    iter_decomposing_pairs,
    msc_renderable,
    nss_to_canonical_elements,
)


# Discoverer tags stamped on synthesized inner pairs. Never collide
# with a real WDS discoverer code (WDS discoverer strings carry a
# trailing catalog number).
SYNTH_NSS_DISCOVERER = "GNSS"
SYNTH_MSC_DISCOVERER = "MSC"

# Synthesized sub-pairs are below WDS's resolution by construction —
# the same ρ = 0.0 convention WDS itself publishes for measured-but-
# unresolved spectroscopic pairs (Castor CIA 29 Aa,Ab). Companion
# promotion reads it as "collocate on the primary"; the runtime renders
# R(t) from the elements alone regardless.
SYNTH_SUB_RESOLUTION_RHO_ARCSEC = 0.0
SYNTH_SUB_RESOLUTION_THETA_DEG = 0.0


def apply_orb6_component_overrides(
    orb6: list[Orb6Entry],
    overrides: dict[tuple[str, str], str],
) -> int:
    """Stamp curated WDS component letters onto ORB6 rows keyed by
    ``(wds_id, discoverer)``. Mutates ``orb6`` in place; returns the
    number of rows rewritten. Curation wins over whatever the fixed-
    width parse produced (usually a blank field)."""
    n = 0
    for e in orb6:
        mapped = overrides.get((e.wds_id, e.discoverer))
        if mapped is not None and e.components != mapped:
            e.components = mapped
            n += 1
    return n


def _is_synthesizable_subpair(components: str) -> bool:
    """A components string worth synthesizing a pair for: splits into
    two distinct single-component tokens (after WDS truncated-form
    expansion). Rejects the fixed-width misalignment garbage ORB6
    carries in this field (``"95"``, ``"r"``, ``"a,Ab"``)."""
    sp = split_components(components)
    if sp is None:
        return False
    primary, secondary = sp
    secondary = expand_wds_truncated_secondary(primary, secondary)
    return (
        primary != secondary
        and is_component_token(primary)
        and is_component_token(secondary)
    )


def synthesize_orb6_orphan_pairs(
    wds_pairs: list[WdsPair],
    orb6: list[Orb6Entry],
) -> list[WdsPair]:
    """One synthesized ``WdsPair`` per ORB6 ``(wds_id, components)`` key
    that names a clean sub-pair WDS_SUMM has no row for (64 Psc Aa,Ab,
    Castor Ca,Cb via the curated override, …). Without the synthesized
    row the orbit is unreachable — every downstream stage walks WDS
    pairs only.

    Geometry: a blank-components WDS row under the same ``(wds_id,
    discoverer)`` is the same physical pair (WDS leaves the field empty
    for plain doubles), so its ρ/θ/mags/date/notes carry over. With no
    donor the pair is sub-resolution: ρ = 0.0, no photometry. The
    precise coord falls back donor → ORB6's own coord prefix → any WDS
    row of the system.
    """
    wds_keys = {(p.wds_id, p.components) for p in wds_pairs}
    blank_by_wds_disc: dict[tuple[str, str], WdsPair] = {}
    coord_by_wds: dict[str, WdsPair] = {}
    for p in wds_pairs:
        if not p.components:
            blank_by_wds_disc.setdefault((p.wds_id, p.discoverer), p)
        if p.precise_ra_deg is not None:
            coord_by_wds.setdefault(p.wds_id, p)

    out: list[WdsPair] = []
    seen: set[tuple[str, str]] = set()
    for e in orb6:
        key = (e.wds_id, e.components)
        if key in wds_keys or key in seen:
            continue
        if not _is_synthesizable_subpair(e.components):
            continue
        seen.add(key)
        donor = blank_by_wds_disc.get((e.wds_id, e.discoverer))
        coord_donor = coord_by_wds.get(e.wds_id)
        if donor is not None and donor.precise_ra_deg is not None:
            precise = (donor.precise_ra_deg, donor.precise_dec_deg)
        elif e.precise_ra_deg is not None:
            precise = (e.precise_ra_deg, e.precise_dec_deg)
        elif coord_donor is not None:
            precise = (coord_donor.precise_ra_deg, coord_donor.precise_dec_deg)
        else:
            precise = (None, None)
        out.append(WdsPair(
            wds_id=e.wds_id,
            discoverer=e.discoverer,
            components=e.components,
            date_last=donor.date_last if donor is not None else None,
            rho_last=(
                donor.rho_last if donor is not None
                else SYNTH_SUB_RESOLUTION_RHO_ARCSEC
            ),
            theta_last=(
                donor.theta_last if donor is not None
                else SYNTH_SUB_RESOLUTION_THETA_DEG
            ),
            mag_pri=donor.mag_pri if donor is not None else None,
            mag_sec=donor.mag_sec if donor is not None else None,
            spectral=donor.spectral if donor is not None else "",
            notes=donor.notes if donor is not None else "",
            precise_ra_deg=precise[0],
            precise_dec_deg=precise[1],
        ))
    return out


def synthesize_msc_inner_pairs(
    wds_pairs: list[WdsPair],
    msc: MscLookup,
) -> tuple[list[WdsPair], dict[str, int]]:
    """One synthesized ``WdsPair`` per WDS-token-mapped MSC orbit whose
    pair WDS never enumerates — the spectroscopic subsystems ORB6 and
    Gaia NSS both miss (AR Cas Aa,Ab, ν Sco Aa1,Aa2). Runs pre-Stage-2
    (after the blank-components rescue, so a rescued implied A,B pair
    counts as existing); the synthesized components ride the normal
    cascade and ``seed_synthesized_component_bindings`` backstops them
    like the ORB6 orphans.

    Gates, mirroring the NSS inner-pair pass: both tokens clean
    single-component tokens; at least one renderable-element orbit row;
    the token pair absent from the system's existing pairs (either
    order); neither token already present; and the pair anchored to the
    existing system — each token's parent token present (top-level
    letters: present in some side's letter set). Unanchored MSC-only
    systems are skipped rather than minting unreachable orphans.
    """
    pair_tokens_by_wds: dict[str, set[frozenset[str]]] = {}
    tokens_by_wds: dict[str, set[str]] = {}
    letters_by_wds: dict[str, set[str]] = {}
    coord_by_wds: dict[str, WdsPair] = {}
    for p in wds_pairs:
        sp = split_components(p.components)
        letters_by_wds.setdefault(p.wds_id, set()).update(
            token_letters(p.components)
        )
        if p.precise_ra_deg is not None:
            coord_by_wds.setdefault(p.wds_id, p)
        if sp is None:
            continue
        primary, secondary = sp
        secondary = expand_wds_truncated_secondary(primary, secondary)
        pair_tokens_by_wds.setdefault(p.wds_id, set()).add(
            frozenset((primary, secondary))
        )
        tokens_by_wds.setdefault(p.wds_id, set()).update((primary, secondary))

    stats = {
        "skipped_unknown_system": 0,
        "skipped_token_shape": 0,
        "skipped_incomplete_elements": 0,
        "skipped_pair_exists": 0,
        "skipped_children_exist": 0,
        "skipped_unanchored": 0,
    }

    def anchored(tok: str, wds_id: str) -> bool:
        parent = parent_component_token(tok)
        if parent is not None:
            return parent in tokens_by_wds.get(wds_id, set())
        return tok in letters_by_wds.get(wds_id, set())

    out: list[WdsPair] = []
    for (wds_id, (tok_a, tok_b)), rows in sorted(msc.orbits_by_pair.items()):
        if wds_id not in letters_by_wds:
            stats["skipped_unknown_system"] += 1
            continue
        if not (
            is_component_token(tok_a) and is_component_token(tok_b)
            and tok_a != tok_b
        ):
            stats["skipped_token_shape"] += 1
            continue
        if not any(msc_renderable(r) for r in rows):
            stats["skipped_incomplete_elements"] += 1
            continue
        if frozenset((tok_a, tok_b)) in pair_tokens_by_wds.get(wds_id, set()):
            stats["skipped_pair_exists"] += 1
            continue
        existing = tokens_by_wds.get(wds_id, set())
        if tok_a in existing or tok_b in existing:
            stats["skipped_children_exist"] += 1
            continue
        if not (anchored(tok_a, wds_id) and anchored(tok_b, wds_id)):
            stats["skipped_unanchored"] += 1
            continue
        coord_donor = coord_by_wds.get(wds_id)
        out.append(WdsPair(
            wds_id=wds_id,
            discoverer=SYNTH_MSC_DISCOVERER,
            components=f"{tok_a},{tok_b}",
            date_last=None,
            rho_last=SYNTH_SUB_RESOLUTION_RHO_ARCSEC,
            theta_last=SYNTH_SUB_RESOLUTION_THETA_DEG,
            mag_pri=None,
            mag_sec=None,
            spectral="",
            notes="",
            precise_ra_deg=(
                coord_donor.precise_ra_deg if coord_donor is not None else None
            ),
            precise_dec_deg=(
                coord_donor.precise_dec_deg if coord_donor is not None else None
            ),
        ))
        pair_tokens_by_wds.setdefault(wds_id, set()).add(
            frozenset((tok_a, tok_b))
        )
        tokens_by_wds.setdefault(wds_id, set()).update((tok_a, tok_b))
    return out, stats


def seed_synthesized_component_bindings(
    components: list[ResolvedComponent],
    synthesized_pairs: list[WdsPair],
) -> int:
    """Post-Stage-2 seeding pass for synthesized-pair components the
    cascade left unresolved. Two inheritance directions, in order:

    1. Primary child ← in-system parent-token component. ``Ca`` takes
       ``C``'s binding: the sub-pair is blended inside the parent's
       Gaia source, so the parent's photocentre source IS the child
       pair's anchor. (Stage 2's own hierarchy pass only propagates the
       other way, sub-letter → bare letter.)
    2. Secondary child ← the pair's primary child. Matches the WDS
       convention for measured spectroscopic pairs, where both sides of
       Castor CIA 29 Aa,Ab carry the same HIP + Gaia source — companion
       promotion detects exactly this shape and mints a synthetic
       catalog record for the secondary.

    Mutates ``components`` in place; returns the number of components
    seeded.
    """
    if not synthesized_pairs:
        return 0
    synth_by_wds_disc = build_pair_by_wds_disc(synthesized_pairs)

    # Strongest in-system binding per (wds_id, component token) —
    # gaia-bearing beats hip-only beats athyg-row-only.
    def strength(c: ResolvedComponent) -> int:
        return (
            (4 if c.gaia_source_id is not None else 0)
            + (2 if c.hip is not None else 0)
            + (1 if c.athyg_row is not None else 0)
        )

    binding_by_letter: dict[tuple[str, str], ResolvedComponent] = {}
    for c in components:
        if strength(c) == 0:
            continue
        key = (c.wds_id, c.component)
        cur = binding_by_letter.get(key)
        if cur is None or strength(c) > strength(cur):
            binding_by_letter[key] = c

    def copy_binding(dst: ResolvedComponent, src: ResolvedComponent) -> bool:
        changed = False
        if dst.gaia_source_id is None and src.gaia_source_id is not None:
            dst.gaia_source_id = src.gaia_source_id
            dst.resolve_via = src.resolve_via
            changed = True
        if dst.hip is None and src.hip is not None:
            dst.hip = src.hip
            changed = True
        if dst.athyg_row is None and src.athyg_row is not None:
            dst.athyg_row = src.athyg_row
            changed = True
        return changed

    n_seeded = 0
    primary_by_pair: dict[tuple[str, str, str], ResolvedComponent] = {}
    for c in components:
        if not c.is_primary:
            continue
        pair = find_owning_pair(c, synth_by_wds_disc)
        if pair is None:
            continue
        if c.gaia_source_id is None:
            parent = parent_component_token(c.component)
            donor = (
                binding_by_letter.get((c.wds_id, parent))
                if parent is not None else None
            )
            if donor is not None and copy_binding(c, donor):
                n_seeded += 1
        primary_by_pair[(c.wds_id, c.discoverer, pair.components)] = c

    for c in components:
        if c.is_primary:
            continue
        pair = find_owning_pair(c, synth_by_wds_disc)
        if pair is None or c.gaia_source_id is not None:
            continue
        primary = primary_by_pair.get((c.wds_id, c.discoverer, pair.components))
        if primary is not None and copy_binding(c, primary):
            n_seeded += 1
    return n_seeded


def synthesize_nss_inner_pairs(
    pairs: list[WdsPair],
    components: list[ResolvedComponent],
    astrometry: list[ComponentAstrometry],
    indices: IdentifierIndices,
) -> tuple[
    list[WdsPair], list[ResolvedComponent], list[ComponentAstrometry],
    dict[str, int],
]:
    """Post-Stage-3 synthesis of inner pairs from Gaia NSS. A component
    whose own source has an ``nss_two_body_orbit`` row while its pair
    partner is a DIFFERENT source hosts an unresolved companion of its
    own — the NSS orbit is interior to that component, not the pair's
    (Stage 4's distinct-source gate stops the misattribution; this pass
    re-homes the orbit on a synthesized sub-pair).

    One inner pair per ``(wds_id, source_id)``: the deepest component
    token carrying the source wins (``Aa`` over ``A`` → children
    ``Aa1,Aa2``), skipping tokens with no deeper WDS convention, systems
    where the child tokens already exist, and NSS rows Stage 4 would
    not attach (out of detectability regime, or missing any of
    P/T/e/ω — an inner pair that can never animate adds nothing).

    Children inherit the carrier's identifiers and astrometry (the
    blended-photocentre convention — see
    ``seed_synthesized_component_bindings``). Returns the three
    parallel lists to append plus skip-reason counters.
    """
    comps_by_system: dict[str, set[str]] = {}
    for c in components:
        comps_by_system.setdefault(c.wds_id, set()).add(c.component)

    carriers: dict[
        tuple[str, int], tuple[ResolvedComponent, ComponentAstrometry],
    ] = {}
    for _pair, c1, c2, a1, a2 in iter_decomposing_pairs(
        pairs, components, astrometry,
    ):
        for comp, comp_ast, partner in ((c1, a1, c2), (c2, a2, c1)):
            g = comp.gaia_source_id
            if g is None or g not in indices.src_to_nss:
                continue
            if partner.gaia_source_id is None or partner.gaia_source_id == g:
                continue
            key = (comp.wds_id, g)
            cur = carriers.get(key)
            if cur is None or len(comp.component) > len(cur[0].component):
                carriers[key] = (comp, comp_ast)

    stats = {
        "skipped_token_shape": 0,
        "skipped_children_exist": 0,
        "skipped_out_of_regime": 0,
        "skipped_incomplete_elements": 0,
    }
    new_pairs: list[WdsPair] = []
    new_components: list[ResolvedComponent] = []
    new_astrometry: list[ComponentAstrometry] = []
    for (wds_id, g), (carrier, carrier_ast) in sorted(carriers.items()):
        children = child_component_tokens(carrier.component)
        if children is None:
            stats["skipped_token_shape"] += 1
            continue
        child_a, child_b = children
        existing = comps_by_system.get(wds_id, set())
        if child_a in existing or child_b in existing:
            stats["skipped_children_exist"] += 1
            continue
        nss_row = indices.src_to_nss[g]
        if not _nss_in_regime(nss_row):
            stats["skipped_out_of_regime"] += 1
            continue
        elements = nss_to_canonical_elements(nss_row, carrier_ast.parallax_mas)
        if (
            elements is None
            or elements.P_days is None or elements.T_jd is None
            or elements.e is None
            # A circular fit legitimately omits ω — Stage 6 backfills
            # the degenerate angle (CIRCULAR_ORBIT_OMEGA_RAD).
            or (elements.omega_rad is None and elements.e != 0.0)
        ):
            stats["skipped_incomplete_elements"] += 1
            continue
        new_pairs.append(WdsPair(
            wds_id=wds_id,
            discoverer=SYNTH_NSS_DISCOVERER,
            components=f"{child_a},{child_b}",
            date_last=None,
            rho_last=SYNTH_SUB_RESOLUTION_RHO_ARCSEC,
            theta_last=SYNTH_SUB_RESOLUTION_THETA_DEG,
            mag_pri=None,
            mag_sec=None,
            spectral="",
            notes="",
            precise_ra_deg=carrier_ast.ra_deg,
            precise_dec_deg=carrier_ast.dec_deg,
        ))
        for child, is_primary in ((child_a, True), (child_b, False)):
            new_components.append(ResolvedComponent(
                wds_id=wds_id,
                discoverer=SYNTH_NSS_DISCOVERER,
                component=child,
                is_primary=is_primary,
                gaia_source_id=g,
                resolve_via=carrier.resolve_via,
                hip=carrier.hip,
                athyg_row=carrier.athyg_row,
            ))
            new_astrometry.append(carrier_ast)
        comps_by_system.setdefault(wds_id, set()).update(children)
    return new_pairs, new_components, new_astrometry, stats
