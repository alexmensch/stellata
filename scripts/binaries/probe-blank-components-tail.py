#!/usr/bin/env python3
"""Instrumentation probe for the full blank→AB ingest decision: runs the
Stage-2 cascade over the blank_components_deferred WDS tail and reports
how many implied A,B pairs would resolve. Read-only."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

SCRIPT = Path(__file__).resolve()
sys.path.insert(0, str(SCRIPT.parents[2]))
from scripts.test_helpers import load_kebab_sibling  # noqa: E402
from scripts.binaries.stage2_resolve import (  # noqa: E402
    IMPLIED_AB_COMPONENTS,
    iter_decomposing_pair_components,
    resolve_all_pairs,
)

# resolve_through_stage2 + log live only on the orchestration shell.
bb = load_kebab_sibling(str(SCRIPT), "build_binaries", "build-binaries.py")


def resolved(c) -> bool:
    return (
        c.gaia_source_id is not None
        or c.hip is not None
        or c.athyg_row is not None
    )


def main() -> int:
    s2 = bb.resolve_through_stage2()

    donor_keys = {
        (p.wds_id, p.discoverer) for p in s2.synthesized_orb6_pairs
    }
    ab_wds_ids = {
        p.wds_id for p in s2.wds_pairs
        if p.components.strip() == IMPLIED_AB_COMPONENTS
    }
    deferred = [
        p for p in s2.wds_pairs
        if not p.components.strip()
        and (p.wds_id, p.discoverer) not in donor_keys
        and p.wds_id not in ab_wds_ids
    ]
    assert len(deferred) == s2.n_deferred, (
        f"deferred replication drifted from the rescue tier: "
        f"{len(deferred):,} != {s2.n_deferred:,}"
    )
    bb.log(f"probing {len(deferred):,} blank_components_deferred rows as implied A,B")

    for p in deferred:
        p.components = IMPLIED_AB_COMPONENTS
    components = resolve_all_pairs(
        pairs=deferred, orb6=s2.orb6,
        indices=s2.indices, athyg=s2.athyg,
        simbad_xids=s2.simbad_wds_xids,
    )

    n_pairs = 0
    pri_via: Counter[str] = Counter()
    sec_via: Counter[str] = Counter()
    n_pri = n_sec = n_any = n_both = n_distinct_gaia = n_sub_resolution = 0
    for pair, pri, sec in iter_decomposing_pair_components(
        deferred, components,
    ):
        n_pairs += 1
        p_ok, s_ok = resolved(pri), resolved(sec)
        n_pri += p_ok
        n_sec += s_ok
        n_any += p_ok or s_ok
        n_both += p_ok and s_ok
        if (
            pri.gaia_source_id is not None
            and sec.gaia_source_id is not None
            and pri.gaia_source_id != sec.gaia_source_id
        ):
            n_distinct_gaia += 1
        if pair.rho_last is not None and pair.rho_last == 0.0:
            n_sub_resolution += 1
        pri_via[pri.resolve_via] += 1
        sec_via[sec.resolve_via] += 1

    def pct(n: int) -> str:
        return f"{n:,} ({n / n_pairs:.1%})"

    bb.log(f"deferred pairs probed: {n_pairs:,}")
    bb.log(f"primary resolved (gaia/hip/athyg): {pct(n_pri)}")
    bb.log(f"secondary resolved: {pct(n_sec)}")
    bb.log(f"any component resolved: {pct(n_any)}")
    bb.log(f"both components resolved: {pct(n_both)}")
    bb.log(f"both ends distinct Gaia sources: {pct(n_distinct_gaia)}")
    bb.log(f"sub-resolution (rho=0) pairs: {pct(n_sub_resolution)}")
    bb.log(f"primary resolve_via: {dict(pri_via.most_common())}")
    bb.log(f"secondary resolve_via: {dict(sec_via.most_common())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
