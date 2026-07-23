#!/usr/bin/env python3
"""Orchestration shell for the WDS → Gaia binary-system pipeline.
Wires the per-stage modules into ``pnpm run build:binaries``.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

SCRIPT = Path(__file__).resolve()

# Direct execution puts this folder on sys.path, not the repo root;
# add the root so the absolute ``scripts.*`` imports below resolve.
sys.path.insert(0, str(SCRIPT.parents[2]))

from scripts.refresh.refresh_lib import assert_row_count, is_up_to_date  # noqa: E402
from scripts.util.paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
DATA = ROOT / "data"

from scripts.binaries.parsers import (  # noqa: E402
    ATHYG_ROW_COUNT_BOUNDS,
    AthygRow,
    CCDM_ROW_COUNT_BOUNDS,
    GCVS_ROW_COUNT_BOUNDS,
    HIP2_ROW_COUNT_BOUNDS,
    ORB6_ROW_COUNT_BOUNDS,
    Orb6Entry,
    SimbadWdsXid,
    WDS_SUMM_ROW_COUNT_BOUNDS,
    WdsPair,
    dedup_wds_pair_rows,
    parse_astrometry_exclusions,
    parse_athyg,
    parse_ccdm,
    parse_component_sptype_overrides,
    parse_gaia_astrometry,
    parse_gaia_hip_xmatch,
    parse_gaia_nss,
    parse_gaia_tyc_xmatch,
    parse_gcvs,
    parse_gcvs_crossid,
    parse_hip2,
    parse_msc_components,
    parse_msc_orbits,
    parse_msc_systems,
    parse_orb6,
    parse_orb6_component_overrides,
    parse_simbad_wds_spectra,
    parse_simbad_wds_xids,
    parse_wds_summ,
)
from scripts.binaries.msc_map import (  # noqa: E402
    build_msc_lookup,
)
from scripts.binaries.indices import (  # noqa: E402
    GAIA_BINDING_G_MINUS_V_REJECT_MAG,
    IdentifierIndices,
    build_indices,
)
from scripts.binaries.subdivide import (  # noqa: E402
    apply_orb6_component_overrides,
    seed_synthesized_component_bindings,
    synthesize_msc_inner_pairs,
    synthesize_nss_inner_pairs,
    synthesize_orb6_orphan_pairs,
)
from scripts.binaries.stage2_resolve import (  # noqa: E402
    BINDING_INTEGRITY_COUNT_KEYS,
    BindingVerdict,
    RESOLVE_VIA_VALUES,
    ResolvedComponent,
    audit_binding_integrity,
    binding_integrity_counts,
    iter_decomposing_pair_components,
    rescue_blank_components_pairs,
    resolution_counts,
    resolve_all_pairs,
    split_components,
    write_astrometry_request,
    write_binding_verdicts_tsv,
)
from scripts.binaries.stage3_astrometry import (  # noqa: E402
    ASTROMETRY_VIA_VALUES,
    astrometry_counts,
    attach_astrometry_all,
)
from scripts.binaries.stage4_orbits import (  # noqa: E402
    ORBIT_VIA_VALUES,
    compute_system_parallax_anchors,
    compute_system_pm_anchors,
    orbit_counts,
    select_orbits_all,
)
from scripts.binaries.stage5_optical import (  # noqa: E402
    OPTICAL_VIA_VALUES,
    classify_all_pairs,
    optical_counts,
)
from scripts.binaries.stage6_multiples import (  # noqa: E402
    ORBIT_ROLE_STANDALONE,
    SPECT_VIA_VALUES,
    build_multiples_rows,
    compute_pair_masses,
    compute_system_anchors,
    write_multiples_tsv,
)
from scripts.binaries.stage7_counts import (  # noqa: E402
    UPDATE_COUNTS_ENV_VAR,
    assert_or_update_counts,
    assert_or_update_rates,
    build_binaries_counts,
    build_binaries_rates,
)

SRC_WDS_SUMM = DATA / "wds" / "wds_summ.txt"
SRC_ORB6 = DATA / "wds" / "orb6_orbits.txt"
SRC_ATHYG = DATA / "athyg" / "athyg_33_classic_ids.csv"
SRC_GCVS = DATA / "gcvs" / "gcvs5.txt"
SRC_GCVS_CROSSID = DATA / "gcvs" / "crossid.txt"
SRC_CCDM = DATA / "hipparcos" / "hip_ccdm.tsv"
SRC_HIP2 = DATA / "hipparcos" / "hip2_van_leeuwen.tsv"
SRC_GAIA_HIP_XM = DATA / "gaia" / "gaia_dr3_hip_xmatch.tsv"
SRC_GAIA_TYC_XM = DATA / "gaia" / "gaia_dr3_tyc_xmatch.tsv"
SRC_GAIA_NSS = DATA / "gaia" / "gaia_dr3_nss_two_body.tsv"
SRC_GAIA_ASTROMETRY = DATA / "gaia" / "gaia_dr3_astrometry.tsv"
SRC_SIMBAD_WDS_XIDS = DATA / "simbad" / "simbad_wds_xids.tsv"
SRC_SIMBAD_SPTYPE = DATA / "simbad" / "simbad_sptype.tsv"
SRC_COMPONENT_SPTYPE_OVERRIDES = (
    DATA / "binaries" / "component_sptype_overrides.tsv"
)
SRC_ORB6_COMPONENT_OVERRIDES = (
    DATA / "binaries" / "orb6_component_overrides.tsv"
)
SRC_ASTROMETRY_EXCLUSIONS = DATA / "binaries" / "astrometry_exclusions.tsv"
SRC_MSC_SYSTEMS = DATA / "msc" / "msc_systems.tsv"
SRC_MSC_ORBITS = DATA / "msc" / "msc_orbits.tsv"
SRC_MSC_COMPONENTS = DATA / "msc" / "msc_components.tsv"

OUT_MULTIPLES = DATA / "binaries" / "multiples.tsv"
OUT_ASTROMETRY_REQUEST = DATA / "gaia" / "gaia_astrometry_source_id_request.tsv"

# Report-only binding-integrity audit artifact (gitignored, regenerated
# each build) — the no-spot-check review surface for the Stage-2
# contradiction detector.
OUT_BINDING_VERDICTS = ROOT / "public" / "binding-integrity-verdicts.tsv"

# Committed snapshot of per-strategy / per-tier counts emitted at the
# end of every build. The Python comparator in stage7_counts.py mirrors
# ``scripts/catalog/build-catalog.ts``'s ``assertOrUpdateBuildCounts``
# flow — refresh deliberately with ``UPDATE_BUILD_COUNTS=1``.
EXPECTED_COUNTS = SCRIPT.parent / "build-binaries-expected.json"
EXPECTED_RATES = SCRIPT.parent / "build-binaries-rates-expected.json"

# Expected fraction of AT-HYG rows that carry a Gaia DR3 source_id. AT-HYG
# documentation reports ~98% coverage (the remainder are bright stars Gaia
# saturated or systems Gaia could not detect). Coverage outside this band
# signals an input drift worth flagging at build time.
ATHYG_GAIA_COVERAGE_BOUNDS = (0.90, 1.00)


def _iter_code_paths() -> Iterator[Path]:
    # The orchestrator is an import shell — the pipeline logic lives in
    # the sibling stage modules and scripts/util, so any of them must
    # invalidate the artifact, not just this file.
    for folder in (SCRIPT.parent, SCRIPT.parent.parent / "util"):
        for mod in sorted(folder.glob("*.py")):
            if not mod.name.endswith(".test.py"):
                yield mod


def _iter_input_paths() -> Iterator[Path]:
    yield from _iter_code_paths()
    yield SRC_WDS_SUMM
    yield SRC_ORB6
    yield SRC_ATHYG
    yield SRC_GCVS
    yield SRC_GCVS_CROSSID
    yield SRC_CCDM
    yield SRC_HIP2
    yield SRC_GAIA_HIP_XM
    yield SRC_GAIA_TYC_XM
    yield SRC_GAIA_NSS
    yield SRC_GAIA_ASTROMETRY
    yield SRC_SIMBAD_WDS_XIDS
    yield SRC_SIMBAD_SPTYPE
    yield SRC_COMPONENT_SPTYPE_OVERRIDES
    yield SRC_ORB6_COMPONENT_OVERRIDES
    yield SRC_ASTROMETRY_EXCLUSIONS
    yield SRC_MSC_SYSTEMS
    yield SRC_MSC_ORBITS
    yield SRC_MSC_COMPONENTS


def log(msg: str) -> None:
    print(f"[build-binaries] {msg}")


DROPPED_PAIR_AUDIT_SAMPLE = 25


def log_dropped_pair_sample(reason: str, dropped: list[str]) -> None:
    """Audit line for a gate that drops pairs before the multiples.tsv
    emit. Dropped pairs never reach the TSV, so the build log is their
    only record — list a capped sample so the suppressed set stays
    reviewable against the literature."""
    if not dropped:
        return
    sample = ", ".join(dropped[:DROPPED_PAIR_AUDIT_SAMPLE])
    suffix = ", …" if len(dropped) > DROPPED_PAIR_AUDIT_SAMPLE else ""
    log(f"{reason}: {len(dropped):,} pairs (sample: {sample}{suffix})")


def log_sep_limit_rejections(
    pairs: list,
    components: list,
    classifications: list,
) -> None:
    """Stage 5's tier-3 separation-limit gate: the WDS systems whose
    optical-double companions were dropped for sitting beyond the
    physical bound-pair limit from the system anchor."""
    rejected = [
        f"{pair.wds_id}{pair.components}"
        for (pair, _p, _s), cls in zip(
            iter_decomposing_pair_components(pairs, components), classifications,
        )
        if cls.optical_via == "sep_limit_rejected"
    ]
    log_dropped_pair_sample(
        "separation-limit rejections: optical doubles dropped", rejected,
    )


@dataclass
class Stage2Resolution:
    """Stage 1 inputs + Stage 2 post-enforcement bindings — the shared
    front half of the pipeline, consumed by ``run`` (Stages 3-7 follow)
    and by ``build-binaries-spotcheck.py`` (asserts the bindings against
    the curated ground truth)."""

    wds_pairs: list[WdsPair]
    n_wds_dup_dropped: int
    orb6: list[Orb6Entry]
    synthesized_orb6_pairs: list[WdsPair]
    synthesized_msc_pairs: list[WdsPair]
    athyg: list[AthygRow]
    indices: IdentifierIndices
    simbad_wds_xids: dict[tuple[str, str], SimbadWdsXid]
    n_rescued: int
    n_deferred: int
    resolve_stats: dict[str, int]
    components: list[ResolvedComponent]
    binding_verdicts: list[BindingVerdict]


def resolve_through_stage2() -> Stage2Resolution:
    """Load every Stage 1 reference catalog, resolve all WDS components
    (Stage 2), and enforce the binding-integrity audit."""
    log("loading reference catalogs (Stage 1) …")

    wds_raw = parse_wds_summ(SRC_WDS_SUMM)
    assert_row_count(
        len(wds_raw), *WDS_SUMM_ROW_COUNT_BOUNDS, "WDS summary parse",
        hint=f"check the source file format of {SRC_WDS_SUMM}",
    )
    wds_pairs, n_wds_dup_dropped = dedup_wds_pair_rows(wds_raw)
    log(f"loaded {len(wds_pairs):,} WDS pair rows")
    if n_wds_dup_dropped:
        log(
            f"dropped {n_wds_dup_dropped:,} duplicate WDS pair rows "
            "(same wds_id + discoverer + components; kept most-observed)"
        )

    orb6 = parse_orb6(SRC_ORB6)
    assert_row_count(
        len(orb6), *ORB6_ROW_COUNT_BOUNDS, "ORB6 parse",
        hint=f"check the source file format of {SRC_ORB6}",
    )
    log(f"loaded {len(orb6):,} ORB6 orbit rows")

    orb6_component_overrides = parse_orb6_component_overrides(
        SRC_ORB6_COMPONENT_OVERRIDES,
    )
    n_overridden = apply_orb6_component_overrides(
        orb6, orb6_component_overrides,
    )
    log(
        f"applied {n_overridden:,} curated ORB6 component overrides "
        f"({len(orb6_component_overrides):,} on file)"
    )

    synthesized_orb6_pairs = synthesize_orb6_orphan_pairs(wds_pairs, orb6)
    wds_pairs.extend(synthesized_orb6_pairs)
    log(
        f"synthesized {len(synthesized_orb6_pairs):,} sub-pairs for ORB6 "
        f"orbits with no WDS pair row"
    )

    athyg = parse_athyg(SRC_ATHYG)
    assert_row_count(
        len(athyg), *ATHYG_ROW_COUNT_BOUNDS, "AT-HYG parse",
        hint=f"check the source file format of {SRC_ATHYG}",
    )
    n_gaia = sum(1 for r in athyg if r.gaia is not None)
    log(f"loaded {len(athyg):,} AT-HYG rows")
    coverage = n_gaia / len(athyg) if athyg else 0.0
    log(f"{n_gaia:,} / {len(athyg):,} AT-HYG rows carry gaia ({coverage:.1%})")
    lo, hi = ATHYG_GAIA_COVERAGE_BOUNDS
    if not (lo <= coverage <= hi):
        log(
            f"WARNING: AT-HYG gaia coverage {coverage:.1%} outside expected "
            f"band [{lo:.0%}, {hi:.0%}] — input drift suspected"
        )

    gcvs = parse_gcvs(SRC_GCVS)
    assert_row_count(
        len(gcvs), *GCVS_ROW_COUNT_BOUNDS, "GCVS parse",
        hint=f"check the source file format of {SRC_GCVS}",
    )
    log(f"loaded {len(gcvs):,} GCVS variable-star rows")

    gcvs_xid = parse_gcvs_crossid(SRC_GCVS_CROSSID)
    log(
        f"loaded GCVS cross-IDs for {len(gcvs_xid):,} designations "
        f"({sum(len(v) for v in gcvs_xid.values()):,} external refs)"
    )

    ccdm = parse_ccdm(SRC_CCDM)
    assert_row_count(
        len(ccdm), *CCDM_ROW_COUNT_BOUNDS, "CCDM parse",
        hint=f"check the VizieR file format of {SRC_CCDM}",
    )
    log(f"loaded {len(ccdm):,} CCDM rows")

    hip2 = parse_hip2(SRC_HIP2)
    assert_row_count(
        len(hip2), *HIP2_ROW_COUNT_BOUNDS, "HIP2 parse",
        hint=f"check the source file format of {SRC_HIP2}",
    )
    log(f"loaded {len(hip2):,} HIP2 van Leeuwen astrometry rows")

    hip_to_gaia = parse_gaia_hip_xmatch(SRC_GAIA_HIP_XM)
    log(
        f"loaded Gaia HIP xmatch; built hip -> gaia_source_id of "
        f"cardinality {len(hip_to_gaia):,}"
    )

    tyc_to_gaia = parse_gaia_tyc_xmatch(SRC_GAIA_TYC_XM)
    log(
        f"loaded Gaia Tycho xmatch; built tyc -> gaia_source_id of "
        f"cardinality {len(tyc_to_gaia):,}"
    )

    src_to_nss = parse_gaia_nss(SRC_GAIA_NSS)
    log(
        f"loaded Gaia NSS two-body; built gaia_source_id -> nss_row of "
        f"cardinality {len(src_to_nss):,}"
    )

    src_to_astrometry = parse_gaia_astrometry(SRC_GAIA_ASTROMETRY)
    log(
        f"loaded Gaia 5p astrometry for {len(src_to_astrometry):,} source_ids"
    )

    astrometry_exclusions = parse_astrometry_exclusions(SRC_ASTROMETRY_EXCLUSIONS)
    n_excluded = sum(1 for s in astrometry_exclusions if s in src_to_astrometry)
    src_to_astrometry = {
        s: row for s, row in src_to_astrometry.items()
        if s not in astrometry_exclusions
    }
    log(
        f"dropped {n_excluded:,} curated-excluded source_ids from the "
        f"astrometry map ({len(astrometry_exclusions):,} on file)"
    )

    simbad_wds_xids = parse_simbad_wds_xids(SRC_SIMBAD_WDS_XIDS)
    n_simbad_gaia = sum(1 for x in simbad_wds_xids.values() if x.gaia_source_id is not None)
    n_simbad_hip = sum(1 for x in simbad_wds_xids.values() if x.hip is not None)
    log(
        f"loaded SIMBAD WDS xids for {len(simbad_wds_xids):,} components "
        f"({n_simbad_gaia:,} Gaia DR3 / {n_simbad_hip:,} HIP)"
    )

    simbad_wds_spectra = parse_simbad_wds_spectra(
        SRC_SIMBAD_SPTYPE, SRC_SIMBAD_WDS_XIDS,
    )
    log(
        f"loaded SIMBAD per-component sp_type for "
        f"{len(simbad_wds_spectra):,} (wds_id, component) pairs"
    )

    component_sptype_overrides = parse_component_sptype_overrides(
        SRC_COMPONENT_SPTYPE_OVERRIDES,
    )
    log(
        f"loaded curated per-component sp_type overrides for "
        f"{len(component_sptype_overrides):,} (wds_id, component) pairs"
    )

    msc = build_msc_lookup(
        systems=parse_msc_systems(SRC_MSC_SYSTEMS),
        orbits=parse_msc_orbits(SRC_MSC_ORBITS),
        components=parse_msc_components(SRC_MSC_COMPONENTS),
    )
    log(
        f"loaded Pulkovo MSC: {len(msc.orbits_by_pair):,} WDS-mapped orbit "
        f"pairs ({msc.n_orbits_unmapped:,} unmappable), "
        f"{len(msc.pair_mags):,} pair-mag entries, "
        f"{len(msc.spect_by_comp):,} per-component spectral types"
    )

    indices = build_indices(
        athyg, hip2, hip_to_gaia, tyc_to_gaia, src_to_nss,
        src_to_astrometry=src_to_astrometry,
        ccdm=ccdm,
        simbad_wds_spectra=simbad_wds_spectra,
        component_sptype_overrides=component_sptype_overrides,
        msc=msc,
    )
    log(
        f"rejected magnitude-inconsistent Gaia bindings "
        f"(G - V > {GAIA_BINDING_G_MINUS_V_REJECT_MAG}): "
        f"{len(indices.xwalk_mag_rejected):,} HIP-xwalk, "
        f"{len(indices.athyg_gaia_mag_rejected):,} AT-HYG gaia cells "
        f"(saturated-primary mis-matches; bare HIPs retained)"
    )
    log(
        f"built AT-HYG identifier views: "
        f"hip -> row {len(indices.hip_to_athyg):,}, "
        f"tyc -> row {len(indices.tyc_to_athyg):,}, "
        f"gaia_source_id -> row {len(indices.src_to_athyg):,}"
    )
    log(
        f"built CCDM views: hip -> ccdm of cardinality "
        f"{len(indices.hip_to_ccdm):,}, ccdm -> hip-list spanning "
        f"{len(indices.ccdm_to_hips):,} systems"
    )
    log(
        f"built hip -> hip2_row of cardinality {len(indices.hip_to_hip2):,}, "
        f"gaia_source_id -> hip of cardinality {len(indices.src_to_hip):,}"
    )

    n_rescued, n_deferred = rescue_blank_components_pairs(
        pairs=wds_pairs, orb6=orb6,
        simbad_xids=simbad_wds_xids,
        synthesized_orb6_pairs=synthesized_orb6_pairs,
    )
    log(
        f"rescued {n_rescued:,} blank-components WDS pairs as implied A,B "
        f"(ORB6-orbit / SIMBAD-xid anchored); {n_deferred:,} position-only "
        f"or unanchored, deferred to the full blank→AB ingest"
    )

    synthesized_msc_pairs, msc_skips = synthesize_msc_inner_pairs(
        wds_pairs, msc,
    )
    wds_pairs.extend(synthesized_msc_pairs)
    log(
        f"synthesized {len(synthesized_msc_pairs):,} MSC inner pairs "
        f"(skipped: " + ", ".join(f"{k}={v:,}" for k, v in msc_skips.items())
        + ")"
    )

    log("Stage 1 complete. Resolving WDS components (Stage 2) …")

    resolve_stats: dict[str, int] = {}
    components = resolve_all_pairs(
        pairs=wds_pairs, orb6=orb6,
        indices=indices, athyg=athyg,
        simbad_xids=simbad_wds_xids,
        stats=resolve_stats,
    )
    log(
        f"sibling-identity rejections: "
        f"{resolve_stats.get('ccdm_sibling_owned_rejected', 0):,} CCDM "
        f"candidates owned by another letter, "
        f"{resolve_stats.get('athyg_match_sibling_claimed_rejected', 0):,} "
        f"AT-HYG position matches onto a row another letter already binds"
    )
    n_seeded = seed_synthesized_component_bindings(
        components, synthesized_orb6_pairs + synthesized_msc_pairs,
    )
    log(f"seeded {n_seeded:,} synthesized-pair component bindings")
    binding_verdicts = audit_binding_integrity(
        wds_pairs, components, indices, apply=True,
        simbad_xids=simbad_wds_xids,
    )
    return Stage2Resolution(
        wds_pairs=wds_pairs, n_wds_dup_dropped=n_wds_dup_dropped,
        orb6=orb6, synthesized_orb6_pairs=synthesized_orb6_pairs,
        synthesized_msc_pairs=synthesized_msc_pairs,
        athyg=athyg, indices=indices, simbad_wds_xids=simbad_wds_xids,
        n_rescued=n_rescued, n_deferred=n_deferred,
        resolve_stats=resolve_stats,
        components=components, binding_verdicts=binding_verdicts,
    )


def run(force: bool) -> int:
    if not force and OUT_MULTIPLES.exists() and is_up_to_date(
        OUT_MULTIPLES, _iter_input_paths(),
    ):
        log(
            f"{OUT_MULTIPLES.relative_to(ROOT)} up to date — skipping "
            "(use --force to rebuild)"
        )
        return 0

    s2 = resolve_through_stage2()
    wds_pairs = s2.wds_pairs
    orb6 = s2.orb6
    athyg = s2.athyg
    indices = s2.indices
    simbad_wds_xids = s2.simbad_wds_xids
    components = s2.components
    binding_verdicts = s2.binding_verdicts
    synthesized_orb6_pairs = s2.synthesized_orb6_pairs
    n_wds_dup_dropped = s2.n_wds_dup_dropped
    n_rescued, n_deferred = s2.n_rescued, s2.n_deferred
    bi_counts = binding_integrity_counts(binding_verdicts)
    n_verdicts = write_binding_verdicts_tsv(
        binding_verdicts, OUT_BINDING_VERDICTS,
    )
    log(
        "binding-integrity audit (enforced): "
        + ", ".join(f"{k}={bi_counts[k]:,}" for k in BINDING_INTEGRITY_COUNT_KEYS)
    )
    log(
        f"wrote {OUT_BINDING_VERDICTS.relative_to(ROOT)} with "
        f"{n_verdicts:,} verdict rows"
    )

    n_requested = write_astrometry_request(
        components, OUT_ASTROMETRY_REQUEST,
        rejected_source_ids=(
            [src for _, src in indices.xwalk_mag_rejected]
            + [src for _, src in indices.athyg_gaia_mag_rejected]
        ),
    )
    log(
        f"wrote {OUT_ASTROMETRY_REQUEST.relative_to(ROOT)} with "
        f"{n_requested:,} unique source_ids (input for the Gaia astrometry refresh)"
    )

    log("Stage 2 complete. Attaching per-component astrometry (Stage 3) …")

    astrometry = attach_astrometry_all(
        components=components, pairs=wds_pairs, indices=indices,
        athyg=athyg,
        stats=s2.resolve_stats,
    )

    nss_pairs, nss_components, nss_astrometry, nss_skips = (
        synthesize_nss_inner_pairs(
            pairs=wds_pairs, components=components,
            astrometry=astrometry, indices=indices,
        )
    )
    wds_pairs.extend(nss_pairs)
    components.extend(nss_components)
    astrometry.extend(nss_astrometry)
    log(
        f"synthesized {len(nss_pairs):,} NSS inner pairs "
        f"(skipped: " + ", ".join(f"{k}={v:,}" for k, v in nss_skips.items())
        + ")"
    )

    counts = resolution_counts(components)
    log(
        "Resolution: "
        + ", ".join(f"{k}={counts[k]:,}" for k in RESOLVE_VIA_VALUES)
    )

    a_counts = astrometry_counts(astrometry)
    log(
        "astrometry routing: "
        + ", ".join(f"{k}={a_counts[k]:,}" for k in ASTROMETRY_VIA_VALUES)
    )

    log("Stage 3 complete. Selecting per-system orbital elements (Stage 4) …")

    orbits = select_orbits_all(
        pairs=wds_pairs, components=components,
        astrometry=astrometry, orb6=orb6, indices=indices,
    )
    o_counts = orbit_counts(orbits)
    log(
        "orbits sourced: "
        + ", ".join(f"{k}={o_counts[k]:,}" for k in ORBIT_VIA_VALUES)
    )

    log("Stage 4 complete. Classifying optical-vs-physical pairs (Stage 5) …")

    system_anchors = compute_system_anchors(wds_pairs, components, astrometry)
    system_parallax_anchors = compute_system_parallax_anchors(
        wds_pairs, components, astrometry,
    )
    pair_masses = compute_pair_masses(wds_pairs, components, indices)
    classifications = classify_all_pairs(
        pairs=wds_pairs, components=components,
        orbits=orbits, indices=indices,
        system_parallax_anchors=system_parallax_anchors,
        pair_masses=pair_masses,
        astrometry=astrometry,
        system_pm_anchors=compute_system_pm_anchors(
            wds_pairs, components, astrometry,
        ),
    )
    op_counts = optical_counts(classifications)
    log(
        "optical-pair cascade: "
        + ", ".join(f"{k}={op_counts[k]:,}" for k in OPTICAL_VIA_VALUES)
    )
    rejected = sum(
        op_counts[k] for k in OPTICAL_VIA_VALUES if k.endswith("_rejected")
    )
    total = len(classifications)
    rejected_rate = rejected / total if total else 0.0
    log(f"optical rejected rate: {rejected_rate:.1%} ({rejected:,} / {total:,})")
    log_sep_limit_rejections(wds_pairs, components, classifications)

    log("Stage 5 complete. Emitting multiples.tsv (Stage 6) …")

    dropped_no_position: list[str] = []
    msc_mag_fills: list[str] = []
    rows = build_multiples_rows(
        pairs=wds_pairs, components=components,
        astrometry=astrometry, orbits=orbits,
        classifications=classifications, indices=indices,
        simbad_xids=simbad_wds_xids,
        system_anchors=system_anchors,
        dropped_no_position=dropped_no_position,
        msc_mag_fills=msc_mag_fills,
    )
    log(
        f"filled pair mags from MSC pair-side V magnitudes on "
        f"{len(msc_mag_fills):,} pairs"
    )
    log_dropped_pair_sample(
        "position-less pair drops: kept pairs with no astrometry and no "
        "system anchor never reach multiples.tsv",
        dropped_no_position,
    )
    n_emitted = write_multiples_tsv(rows, OUT_MULTIPLES)
    n_standalone = sum(1 for r in rows if r.orbit_role == ORBIT_ROLE_STANDALONE)
    log(
        f"wrote {OUT_MULTIPLES.relative_to(ROOT)} with {n_emitted:,} "
        f"component rows ({(n_emitted - n_standalone) // 2:,} physical pairs "
        f"+ {n_standalone:,} standalone rows)"
    )
    spect_via_counts = {tag: 0 for tag in SPECT_VIA_VALUES}
    for r in rows:
        spect_via_counts[r.spect_via] = spect_via_counts.get(r.spect_via, 0) + 1
    log(
        "spect provenance: "
        + ", ".join(
            f"{tag}={spect_via_counts[tag]:,}" for tag in SPECT_VIA_VALUES
        )
    )

    log("Stage 6 complete. Comparing build counts against snapshot (Stage 7) …")

    counts = build_binaries_counts(
        pairs=wds_pairs, components=components, astrometry=astrometry,
        orbits=orbits, classifications=classifications, multiples_rows=rows,
        synthesized_orb6_pairs=len(synthesized_orb6_pairs),
        synthesized_nss_pairs=len(nss_pairs),
        synthesized_msc_pairs=len(s2.synthesized_msc_pairs),
        msc_pair_mags_filled=len(msc_mag_fills),
        msc_orbits_unmapped=indices.msc.n_orbits_unmapped if indices.msc else 0,
        binding_integrity=bi_counts,
        xwalk_mag_rejected=len(indices.xwalk_mag_rejected),
        athyg_gaia_mag_rejected=len(indices.athyg_gaia_mag_rejected),
        wds_duplicate_pair_rows_dropped=n_wds_dup_dropped,
        multiples_pairs_dropped_no_position=len(dropped_no_position),
        blank_components_rescued=n_rescued,
        blank_components_deferred=n_deferred,
        ccdm_sibling_owned_rejected=s2.resolve_stats.get(
            "ccdm_sibling_owned_rejected", 0,
        ),
        athyg_match_sibling_claimed_rejected=s2.resolve_stats.get(
            "athyg_match_sibling_claimed_rejected", 0,
        ),
    )
    counts_match = assert_or_update_counts(counts, EXPECTED_COUNTS)
    rates = build_binaries_rates(counts)
    rates_match = assert_or_update_rates(rates, EXPECTED_RATES)
    if not counts_match or not rates_match:
        log(
            f"build-binaries assertion failed. If the change is "
            f"intentional, refresh with: "
            f"{UPDATE_COUNTS_ENV_VAR}=1 pnpm run build:binaries"
        )
        return 1

    log("Stage 7 complete. data/binaries/multiples.tsv ready for Phase 3 ingest.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--force", action="store_true",
        help="ignore mtime check and reload all inputs",
    )
    args = p.parse_args()
    return run(force=args.force)


if __name__ == "__main__":
    sys.exit(main())
