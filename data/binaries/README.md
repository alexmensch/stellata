# Binary-system pipeline output + curated inputs

Pipeline-derived output plus two hand-curated inputs. Lives alongside
its source folders under `data/` so the binary-system pipeline's data
stays in one place.

```
multiples.tsv                   build-binaries.py output. Two rows per
                                kept physical WDS pair (incl. sub-pairs
                                synthesized from ORB6 / Gaia NSS — see
                                scripts/binaries/README.md § Sub-pair
                                synthesis), plus standalone rows for
                                SIMBAD-known components the pair walk
                                didn't reach. ~7 MB, LFS.
component_sptype_overrides.tsv  Hand-curated per-component MK types for
                                components no machine source carries
                                (Algol Aa2 K0IV, δ Vel Ab, σ Ori Ab,
                                Castor Ab/Bb/Ca/Cb). Top tier of Stage
                                6's spectral cascade (spect_via=curated).
                                Component keys use the raw multiples
                                comp form (Algol's Aa1,2 secondary is
                                "2"); every entry cites its literature
                                source. LFS (data/binaries/*.tsv).
orb6_component_overrides.tsv    Hand-curated WDS component letters for
                                ORB6 rows whose components field is
                                blank — the catalog names the pair only
                                by its variable-star designation
                                (YY Gem = Castor Ca,Cb). Keyed on
                                (wds_id, discoverer); applied before
                                orphan sub-pair synthesis; every entry
                                cites its literature source. LFS
                                (data/binaries/*.tsv).
astrometry_exclusions.tsv       Hand-curated Gaia DR3 source_ids whose
                                5p astrometry is unusable — a companion
                                blended with a Gaia-saturating primary
                                (Sirius B). Dropped from the astrometry
                                map at Stage 1, so the component falls
                                back to a WDS/ORB6-projected position
                                (epoch-clean). Identity preserved; only
                                the position is suppressed. Every entry
                                cites why. LFS (data/binaries/*.tsv).
spot_check_ground_truth.tsv     SIMBAD-verified expected Stage 2
                                resolutions for ~90 well-known
                                (wds_id, component) rows. Read by the
                                end-to-end spot-check harness
                                (stellata-9mm.203.2). See § Spot-check
                                ground truth. Regular git.
```

## Schema

Canonical column order is `MULTIPLES_TSV_COLUMNS` in
[`scripts/binaries/stage6_multiples.py`](../../scripts/binaries/README.md):

```
system_id, comp, hip, gaia_source_id,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, astrometry_via, orbit_via, spect_via,
photometry_via, a_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc,
sep_arcsec, pa_deg, sep_pa_epoch_jd, dmag
```

Per-component provenance columns (`resolve_via`, `astrometry_via`,
`orbit_via`, `spect_via`, `photometry_via`, `a_via`) name which
strategy / catalogue tier supplied each piece of data. Canonical
values live in
[`scripts/binaries/`](../../scripts/binaries/README.md).

## Spot-check ground truth

`spot_check_ground_truth.tsv` pins the Stage 2 resolution the pipeline
is expected to produce for a curated set of famous / structurally
interesting systems, so a parser regression, an over-firing tier, or an
input-data refresh that silently re-resolves a well-known star fails a
test instead of surfacing at render time. This matters most when the
ingest set expands by orders of magnitude (stellata-dch.102,
stellata-cns): the curated rows are the fixed reference frame that
millions of un-spot-checkable rows can't provide.

Schema: `category, name, wds_id, component, expected_resolve_via,
expected_gaia_source_id, note`.

Assertion semantics (the contract the harness implements):

- **Expectations pin verified current behaviour, not aspiration.** A
  row's `(expected_resolve_via, expected_gaia_source_id)` is the
  strongest-priority `ResolvedComponent` Stage 2 emits for that
  `(wds_id, component)` today, cross-checked against SIMBAD. Where
  current behaviour is knowably wrong, the note starts with
  `known_bug:<bead-id>` and states the SIMBAD-true value — fixing the
  bug flips the row, and the harness failure is the prompt to update
  it.
- `expected_resolve_via` is one of `RESOLVE_VIA_VALUES`
  (`scripts/binaries/stage2_resolve.py`) **plus `absent`**: Stage 2
  emits no component at all for that `(wds_id, component)` (today:
  blank-components WDS rows, stellata-dch.102).
- Blank `expected_gaia_source_id` with `expected_resolve_via=unresolved`
  asserts the component resolves to no source (Sirius-A class). Blank
  is impossible with any other tier — every non-`unresolved` row
  carries the id to assert.
- Categories group failures by regime; rows inside them were chosen to
  sweep every live resolve tier and every structural shape at least
  once: sub-letter and `Aa1,2` tokens, `BC`/`AB` aggregate tokens with
  their own SIMBAD objects, CCDM blend-inherit secondaries (id equals
  the primary's by design), unpaired standalone letters, 2+2
  quadruples, dense cluster fields, WD / brown-dwarf companions.

Provenance: every `expected_gaia_source_id` was verified against
SIMBAD TAP (`https://simbad.cds.unistra.fr/simbad/sim-tap`) on
2026-07-06 via the per-component ident form dch.60 established
(`WDS J<id><comp>`, no space), falling back to the canonical name
(`* alf CMa B`, `* omi Cet`) where SIMBAD stores no WDS-component
ident:

```sql
SELECT i1.id, b.main_id, i2.id FROM ident i1
  JOIN basic b ON b.oid = i1.oidref
  LEFT JOIN ident i2 ON i2.oidref = i1.oidref
    AND i2.id LIKE 'Gaia DR3 %'
  WHERE i1.id IN (…)
```

The `note` column names the SIMBAD `main_id` each id traces to.
Adding a star later = one appended line verified the same way.

## Produced by

`scripts/binaries/build-binaries.py` (Stage 6 emits;
`npm run build:binaries`). See
[`scripts/binaries/README.md`](../../scripts/binaries/README.md) for
the seven-stage pipeline + per-stage modules.

## Consumed by

- `scripts/catalog/companion-promotion.ts` (build-time — surfaces pair
  secondaries as catalog.bin records).
- `scripts/binaries/build-runtime-binaries.py` (emits
  `public/binaries.bin` for the per-frame
  [`src/client/binaries/`](../../src/client/binaries/README.md) layer).
- `scripts/catalog/known-stars.test.ts` +
  `multi-star-regression.test.ts` (Tier A validation harnesses).
- Ad-hoc debugging of cross-match decisions.
