#!/usr/bin/env python3
"""Catalogue builder for the source-ID-anchored binary-system pipeline — Stages 1-7.

Stage 1 (``stellata-dch.27``) loads every reference catalog the resolution
chain needs (WDS + ORB6 + AT-HYG + GCVS + CCDM + HIP2 + Gaia HIP/Tyc
cross-walks + Gaia NSS + Gaia 5p astrometry) and builds the identifier
indices that Stages 2-7 consume.

Stage 2 (``stellata-dch.28`` + ``.60`` + ``.61``) resolves each WDS
component to a Gaia DR3 ``source_id`` via the cascade canonicalised in
``RESOLVE_VIA_VALUES``:

* ``orb6_hip`` — primary's ORB6-published HIP → Gaia HIP xwalk.
* ``athyg_gaia_native`` — AT-HYG's natively-stored ``gaia`` field
  reached either through the same HIP or, in a later pass, via a 2″
  position match against the WDS precise coordinates (PM-propagated;
  see ``ATHYG_REFERENCE_EPOCH``).
* ``simbad_xid`` (``stellata-dch.60``) — SIMBAD's curated
  ``WDS J<id><comp>`` ↔ Gaia DR3 cross-IDs read from the committed
  ``data/simbad/simbad_wds_xids.tsv`` side-file (refresh script
  ``scripts/refresh/refresh-simbad-wds-xids.py``). Per-component
  resolution with reliable coverage of the well-known hard cases.
* ``ccdm_hip`` (``stellata-dch.61``) — Hipparcos CCDM annex
  (``data/hipparcos/hip_ccdm.tsv``) lists every HIP that co-belongs to a
  CCDM-identified multiple system. For each WDS pair whose ``wds_id``
  matches a CCDM identifier, the candidate-HIP set is restricted to
  CCDM co-members and a tight position match against AT-HYG
  disambiguates which sibling HIP is which WDS component letter. Then
  the same Gaia HIP xwalk / AT-HYG-native paths fire on the bound HIP.
  Picks up α Cen B and Proxima-shaped cases that the primary-only
  ``orb6_hip`` and the bare position match would have missed.
* ``position_pm`` / ``position_nopm`` — PM-propagated and bare
  position match against ``data/gaia/gaia_dr3_astrometry.tsv``. Stubbed
  (placeholder tier names; ``stellata-dch.29`` lands the data file
  but the cascade hand-off for these tiers is future work).

Stage 3 (``stellata-dch.30``) attaches the most-trustworthy astrometric
measurement to each resolved component, routing between Gaia DR3 5p,
Gaia NSS-systemic, and Hipparcos-2 long-baseline solutions:

* ``gaia_nss_systemic`` — source has an NSS two-body-orbit row AND the
  5p solution is flagged unreliable (``ruwe > 1.4`` OR
  ``ipd_frac_multi_peak > 0.02``). Gaia DR3 refits ``gaia_source`` to
  the centre-of-mass for NSS-modeled sources, so the same row's values
  surface with this routing tag distinguishing provenance for Stage 4.
* ``hip2_long_baseline`` — the WDS pair has a close companion (min
  ρ across all pair rows the source participates in is ≤ 5″) AND
  ``|pmRA_gaia − pmRA_hip2| > 50 mas/yr`` OR ``|pmDE_gaia − pmDE_hip2|
  > 50 mas/yr``. Hipparcos's J1991.25-anchored long baseline averages
  a different window of the orbit than Gaia's 2014-2017 window; for
  bright close binaries (Sirius, α Cen, Castor) the long-baseline PM
  is closer to the systemic motion of the centre of mass.
* ``gaia_5p`` — default.

Stage 4 (``stellata-dch.31``) picks orbital elements per WDS pair from
Gaia NSS two-body orbits or ORB6, preferring NSS inside Gaia's
astrometric-detectability regime (P < ~3 yr OR a < 1″). ORB6 grades
1-5 own the visual-orbit fallback; ORB6 grades 8-9 own the
spectroscopic-only fallback. The Thiele-Innes → Campbell algebra
(Heintz 1978 / Halbwachs+ 2023 Appendix B) is implemented in-repo
rather than via ESA NSSTools — the dependency is unmaintained and the
algebra is ~10 lines. Returns ``(orbit_dict, orbit_via)`` per pair via
``select_orbit``; ``orbit_via`` ∈ ``{gaia_nss, orb6, orb6_spectroscopic,
none}``.

Stage 2 emits ``data/gaia/gaia_astrometry_source_id_request.tsv`` (the
deduped union of every Gaia source_id Stage 2 resolved, across every
tier), which ``scripts/refresh/refresh-gaia-astrometry.py`` (dch.29)
reads to drive its ADQL query.

Stage 5 (``stellata-dch.32``) classifies each WDS pair as physical or
optical via a 5-tier ID-anchored cascade: WDS Notes flag chars (T/V/Z
keep, S/U/X/Y reject) → both-Gaia gate (parallax 3σ + per-axis PM
≤5 mas/yr) → asymmetric-Gaia gate (Gaia primary + HIP2-anchored
secondary, or vice versa; catches Sirius A-C/D/E/F directly) →
orbit-on-file override (Stage 4 selected real orbital elements, so
the pair is empirically bound; rescues WD-companion pairs like
Sirius A-B that mag-gap alone would reject) → mag-gap heuristic
backstop (|Δmag| ≤ 5 keep).

Stage 6 (``stellata-dch.32``) emits ``data/binaries/multiples.tsv`` — two rows
per kept pair, columns per ``MULTIPLES_TSV_COLUMNS`` (system_id,
component, hip / gaia_source_id, ICRS x/y/z parsec position, AT-HYG
photometric / spectral metadata, orbital elements from Stage 4,
resolve / astrometry / orbit provenance tags). Phase 3's v6 binary
writer is the consumer.

Stage 7 (``stellata-dch.32``) flattens per-strategy + per-tier counters
into ``scripts/binaries/build-binaries-expected.json`` for ``stellata-dch.39``
(Phase 4 Tier B) to gate population statistical bounds against.
Refresh deliberately with ``UPDATE_BUILD_COUNTS=1``.

Run via ``npm run build:binaries`` (or directly: ``python3
scripts/binaries/build-binaries.py``). Idempotent against
``data/binaries/multiples.tsv``; pass ``--force`` to ignore the mtime
check and reload everything.

See the parent epic ``stellata-dch`` for the seven-stage architecture.

Decomposition history: stellata-9mm.204 split Stages 1-7 into sibling
modules (``parsers``, ``indices``, ``stage2_resolve``,
``stage3_astrometry``, ``stage4_orbits``, ``stage5_optical``,
``stage6_multiples``, ``stage7_counts``). This file is the
orchestration shell — pipeline entry point, source-path constants, and
namespace replication so the existing test loader's ``bb.<name>``
access pattern keeps working without per-stage rewiring.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
SCRIPT = Path(__file__).resolve()

# Make this folder (so sibling stage modules find each other) and
# scripts/refresh/ (so refresh_lib resolves) reachable from any caller —
# direct invocation, ``npm run build:binaries``, or the test loader's
# spec_from_file_location.
sys.path.insert(0, str(SCRIPT.parent.parent / "refresh"))
sys.path.insert(0, str(SCRIPT.parent))

from refresh_lib import is_up_to_date  # noqa: E402

import parsers  # noqa: E402
import indices as _indices_module  # noqa: E402
import stage2_resolve  # noqa: E402
import stage3_astrometry  # noqa: E402
import stage4_orbits  # noqa: E402
import stage5_optical  # noqa: E402
import stage6_multiples  # noqa: E402
import stage7_counts  # noqa: E402

# Replicate every symbol from each sibling stage module into this
# module's namespace. Two consumers rely on the ``build_binaries.<name>``
# contract this preserves:
#   1. ``scripts/binaries/build-binaries.test.py`` loads this file via
#      ``spec_from_file_location("build_binaries", …)`` and accesses
#      stage symbols as ``bb.parse_wds_summ``, ``bb._thiele_innes_to_campbell``,
#      etc. — including underscore-prefixed internals that ``import *``
#      would skip.
#   2. ``scripts/refresh/refresh-simbad-wds-xids.py`` loads this file
#      the same way to reuse ``parse_wds_summ`` and ``split_components``.
# Both pre-date the stellata-9mm.204 stage split; the loop keeps them
# working without per-call-site rewiring.
for _mod in (
    parsers, _indices_module, stage2_resolve, stage3_astrometry,
    stage4_orbits, stage5_optical, stage6_multiples, stage7_counts,
):
    for _name in dir(_mod):
        if _name.startswith("__"):
            continue
        globals().setdefault(_name, getattr(_mod, _name))
del _mod, _name
del parsers, _indices_module, stage2_resolve, stage3_astrometry
del stage4_orbits, stage5_optical, stage6_multiples, stage7_counts

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

OUT_MULTIPLES = DATA / "binaries" / "multiples.tsv"
OUT_ASTROMETRY_REQUEST = DATA / "gaia" / "gaia_astrometry_source_id_request.tsv"

# Committed snapshot of per-strategy / per-tier counts emitted at the
# end of every build. ``stellata-dch.39`` (Phase 4 Tier B) will pin
# bounds against this file from the TS side. The Python comparator
# in stage7_counts.py mirrors ``scripts/catalog/build-catalog.ts``'s
# ``assertOrUpdateBuildCounts`` flow — refresh deliberately with
# ``UPDATE_BUILD_COUNTS=1``.
EXPECTED_COUNTS = SCRIPT.parent / "build-binaries-expected.json"

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

    indices = build_indices(
        athyg, hip2, hip_to_gaia, tyc_to_gaia, src_to_nss,
        src_to_astrometry=src_to_astrometry,
        ccdm=ccdm,
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
    counts = resolution_counts(components)
    log(
        "Resolution: "
        + ", ".join(f"{k}={counts[k]:,}" for k in RESOLVE_VIA_VALUES)
    )

    n_requested = write_astrometry_request(components, OUT_ASTROMETRY_REQUEST)
    log(
        f"wrote {OUT_ASTROMETRY_REQUEST.relative_to(ROOT)} with "
        f"{n_requested:,} unique source_ids (input for stellata-dch.29)"
    )

    log("Stage 2 complete. Attaching per-component astrometry (Stage 3) …")

    astrometry = attach_astrometry_all(
        components=components, pairs=wds_pairs, indices=indices,
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
    )
    n_emitted = write_multiples_tsv(rows, OUT_MULTIPLES)
    log(
        f"wrote {OUT_MULTIPLES.relative_to(ROOT)} with {n_emitted:,} "
        f"component rows ({n_emitted // 2:,} physical pairs)"
    )

    log("Stage 6 complete. Comparing build counts against snapshot (Stage 7) …")

    counts = build_binaries_counts(
        pairs=wds_pairs, components=components, astrometry=astrometry,
        orbits=orbits, classifications=classifications, multiples_rows=rows,
    )
    counts_match = assert_or_update_counts(counts, EXPECTED_COUNTS)
    if not counts_match:
        log(
            f"build-binaries count assertion failed. If the change is "
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
