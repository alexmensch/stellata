#!/usr/bin/env python3
"""Orchestration shell for the WDS → Gaia binary-system pipeline.
Wires the per-stage modules into ``npm run build:binaries``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterator

SCRIPT = Path(__file__).resolve()

# Make this folder (so sibling stage modules find each other),
# scripts/refresh/ (so refresh_lib resolves), and scripts/util/ (so
# paths resolves) reachable from any caller — direct invocation,
# ``npm run build:binaries``, or the test loader's
# spec_from_file_location.
sys.path.insert(0, str(SCRIPT.parent.parent / "refresh"))
sys.path.insert(0, str(SCRIPT.parent.parent / "util"))
sys.path.insert(0, str(SCRIPT.parent))

from refresh_lib import is_up_to_date  # noqa: E402
from paths import REPO_ROOT  # noqa: E402

ROOT = REPO_ROOT
DATA = ROOT / "data"

# Explicit per-stage re-exports. Two consumers load this file via
# ``spec_from_file_location("build_binaries", …)`` and reach stage
# symbols as ``bb.<name>``: ``scripts/binaries/build-binaries.test.py``
# (including the four underscore-prefixed internals listed below), and
# ``scripts/refresh/refresh-simbad-wds-xids.py`` (reuses
# ``parse_wds_summ`` + ``split_components``). ``run()`` below also
# consumes these names directly.

from parsers import (  # noqa: E402, F401
    AthygRow, CcdmRow, GaiaAstrometryRow, Hip2Row, Orb6Entry,
    SimbadWdsXid, WdsPair,
    parse_athyg, parse_ccdm, parse_gaia_astrometry,
    parse_gaia_hip_xmatch, parse_gaia_nss, parse_gaia_tyc_xmatch,
    parse_gcvs, parse_gcvs_crossid, parse_hip2,
    parse_component_sptype_overrides, parse_orb6,
    parse_orb6_component_overrides,
    parse_simbad_wds_spectra, parse_simbad_wds_xids,
    parse_wds_summ,
)
from indices import (  # noqa: E402, F401
    IdentifierIndices, WDS_PRECISE_COORD_EPOCH, build_indices,
)
from component_tokens import (  # noqa: E402, F401
    child_component_tokens, expand_wds_truncated_secondary,
    is_component_token, parent_component_token,
)
from subdivide import (  # noqa: E402, F401
    SYNTH_NSS_DISCOVERER,
    apply_orb6_component_overrides,
    seed_synthesized_component_bindings,
    synthesize_nss_inner_pairs,
    synthesize_orb6_orphan_pairs,
)
from stage2_resolve import (  # noqa: E402, F401
    RESOLVE_VIA_PRIORITY, RESOLVE_VIA_VALUES, ResolvedComponent,
    _athyg_position_at_epoch, _propagate_position,
    build_athyg_position_grid, build_pair_by_wds_disc,
    find_nearest_athyg_at_position, group_orb6_by_pair,
    iter_decomposing_pair_components,
    predict_secondary_position, propagate_blend_identity,
    propagate_within_system,
    resolution_counts, resolve_all_pairs, resolve_component,
    resolve_via_ccdm, resolve_via_position, resolve_via_simbad,
    split_components, write_astrometry_request,
)
from stage3_astrometry import (  # noqa: E402, F401
    ASTROMETRY_VIA_VALUES, ComponentAstrometry,
    astrometry_counts, attach_astrometry, attach_astrometry_all,
    compute_min_rho_per_source, gaia_5p_unreliable,
)
from stage4_orbits import (  # noqa: E402, F401
    GAIA_DR3_REF_EPOCH_JD, J2000_REF_EPOCH_JD, MJD_TO_JD_OFFSET,
    TRUNCATED_JD_TO_JD_OFFSET, T0_MIN_PLAUSIBLE_JD, T0_MAX_PLAUSIBLE_JD,
    ORBIT_VIA_VALUES, OrbitElements,
    NSS_MAX_SYSTEM_MASS_MSUN, NSS_SEPARATION_SANITY_RATIO,
    _nss_separation_consistent,
    compute_system_parallaxes, first_astrometry_field_per_system,
    _pick_best_orb6, _system_parallax_mas, _thiele_innes_to_campbell,
    iter_decomposing_pairs, kepler_semimajor_axis_au,
    nss_to_canonical_elements,
    orb6_to_canonical_elements, orbit_counts,
    select_orbit, select_orbits_all,
)
from stage5_optical import (  # noqa: E402, F401
    OPTICAL_VIA_VALUES, OpticalClassification,
    classify_all_pairs, classify_pair_optical, optical_counts,
)
from stage6_multiples import (  # noqa: E402, F401
    ASTROMETRY_VIA_SYSTEM_INHERITED, CIRCULAR_ORBIT_OMEGA_RAD,
    ESTIMATED_ELEMENT_ORBIT_VIAS, MULTIPLES_TSV_COLUMNS,
    ORBIT_ROLE_STANDALONE, SPECT_VIA_VALUES,
    A_VIA_CATALOG, A_VIA_KEPLER_MASS_ESTIMATE, A_VIA_NONE, A_VIA_VALUES,
    PHOTOMETRY_VIA_NONE, PHOTOMETRY_VIA_OWN,
    PHOTOMETRY_VIA_SYSTEM_INHERITED, PHOTOMETRY_VIA_VALUES,
    MultiplesRow,
    build_multiples_rows, build_standalone_rows,
    compute_system_anchors, finalize_renderable_elements,
    wds_dmag, wds_year_to_jd, write_multiples_tsv,
)
from stage7_counts import (  # noqa: E402, F401
    DEFAULT_RATE_TOLERANCE, UPDATE_COUNTS_ENV_VAR,
    assert_or_update_counts, assert_or_update_rates,
    build_binaries_counts, build_binaries_rates, compare_build_counts,
    compare_build_rates,
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

OUT_MULTIPLES = DATA / "binaries" / "multiples.tsv"
OUT_ASTROMETRY_REQUEST = DATA / "gaia" / "gaia_astrometry_source_id_request.tsv"

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


def _iter_input_paths() -> Iterator[Path]:
    yield SCRIPT
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


def log(msg: str) -> None:
    print(f"[build-binaries] {msg}")


def run(force: bool) -> int:
    if not force and OUT_MULTIPLES.exists() and is_up_to_date(
        OUT_MULTIPLES, _iter_input_paths(),
    ):
        log(
            f"{OUT_MULTIPLES.relative_to(ROOT)} up to date — skipping "
            "(use --force to rebuild)"
        )
        return 0

    log("loading reference catalogs (Stage 1) …")

    wds_pairs = parse_wds_summ(SRC_WDS_SUMM)
    log(f"loaded {len(wds_pairs):,} WDS pair rows")

    orb6 = parse_orb6(SRC_ORB6)
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
    log(f"loaded {len(gcvs):,} GCVS variable-star rows")

    gcvs_xid = parse_gcvs_crossid(SRC_GCVS_CROSSID)
    log(
        f"loaded GCVS cross-IDs for {len(gcvs_xid):,} designations "
        f"({sum(len(v) for v in gcvs_xid.values()):,} external refs)"
    )

    ccdm = parse_ccdm(SRC_CCDM)
    log(f"loaded {len(ccdm):,} CCDM rows")

    hip2 = parse_hip2(SRC_HIP2)
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

    indices = build_indices(
        athyg, hip2, hip_to_gaia, tyc_to_gaia, src_to_nss,
        src_to_astrometry=src_to_astrometry,
        ccdm=ccdm,
        simbad_wds_spectra=simbad_wds_spectra,
        component_sptype_overrides=component_sptype_overrides,
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

    log("Stage 1 complete. Resolving WDS components (Stage 2) …")

    components = resolve_all_pairs(
        pairs=wds_pairs, orb6=orb6,
        indices=indices, athyg=athyg,
        simbad_xids=simbad_wds_xids,
    )
    n_seeded = seed_synthesized_component_bindings(
        components, synthesized_orb6_pairs,
    )
    log(f"seeded {n_seeded:,} synthesized-pair component bindings")
    counts = resolution_counts(components)
    log(
        "Resolution: "
        + ", ".join(f"{k}={counts[k]:,}" for k in RESOLVE_VIA_VALUES)
    )

    n_requested = write_astrometry_request(components, OUT_ASTROMETRY_REQUEST)
    log(
        f"wrote {OUT_ASTROMETRY_REQUEST.relative_to(ROOT)} with "
        f"{n_requested:,} unique source_ids (input for the Gaia astrometry refresh)"
    )

    log("Stage 2 complete. Attaching per-component astrometry (Stage 3) …")

    astrometry = attach_astrometry_all(
        components=components, pairs=wds_pairs, indices=indices,
        athyg=athyg,
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

    classifications = classify_all_pairs(
        pairs=wds_pairs, components=components,
        orbits=orbits, indices=indices,
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

    log("Stage 5 complete. Emitting multiples.tsv (Stage 6) …")

    rows = build_multiples_rows(
        pairs=wds_pairs, components=components,
        astrometry=astrometry, orbits=orbits,
        classifications=classifications, indices=indices,
        simbad_xids=simbad_wds_xids,
    )
    n_emitted = write_multiples_tsv(rows, OUT_MULTIPLES)
    log(
        f"wrote {OUT_MULTIPLES.relative_to(ROOT)} with {n_emitted:,} "
        f"component rows ({n_emitted // 2:,} physical pairs)"
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
    )
    counts_match = assert_or_update_counts(counts, EXPECTED_COUNTS)
    rates = build_binaries_rates(counts)
    rates_match = assert_or_update_rates(rates, EXPECTED_RATES)
    if not counts_match or not rates_match:
        log(
            f"build-binaries assertion failed. If the change is "
            f"intentional, refresh with: "
            f"{UPDATE_COUNTS_ENV_VAR}=1 npm run build:binaries"
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
