# Stage 6 — multiples.tsv records, in TypeScript

The TypeScript Stage 6 of the binaries pipeline: every pair Stage 5 kept
(`../optical/`) becomes two `MultiplesRecord`s, the shape `../multiples-tsv.ts`
encodes, then each SIMBAD-known component no kept pair reached becomes one
standalone record; `../build-binaries.ts` calls it. What each column carries,
the anchor offsets and the backstops, and why:
[What each column carries](#what-each-column-carries).

## Files in this area

```
scripts/binaries/multiples/
  attach-multiples.ts (+ test)      attachStage6 (the pair walk, then the
                                    standalone sweep), Stage6Result,
                                    stage6Counts.
  multiples-rows-pure.ts (+ test)   positionPc (a position at the scene
                                    epoch), pairRows, standaloneRow,
                                    orbitFields (q backfill and the
                                    estimated-element backstops),
                                    wdsYearToJd.
  anchor-offsets-pure.ts (+ test)   computeAnchorOffsets: each system's
                                    anchor letter and every reached
                                    component's offset from it;
                                    photocentreOffsets.
  gaia-photometry-pure.ts (+ test)  gaiaPhotometryAbsmagCi: M_V and B−V from
                                    a component's own Gaia row.
  pair-photometry-pure.ts (+ test)  pairMagnitudes (WDS's, else the MSC's)
                                    and wdsDmag.
  stage6-report-pure.ts             The build-log lines, read off the result.
  stage6-fixture.ts                 Test-only: runStage6 over hand-built
                                    pairs.
```

## The shape of a result

`Stage6Result.rows` is the file's row order: two rows per kept, placed pair in
Stage 3's pair order, then the standalone rows in the SIMBAD cross-ID file's
order. A kept pair with no position on either side and no system anchor is not
a row; its `<wds_id><components>` is in `droppedNoPosition`, the only record of
it. `mscMagFills` names the pairs whose magnitudes came from the MSC.

Each record is built whole, never patched: `pairRows` composes the two
components' own fields, the fields the pair shares (orbit, q, the backstops,
WDS geometry and magnitudes) and each side's anchor offset.

## System-inherited positions

A component with no position of its own takes its system's: the first measured
position among the system's pairs in pair order, primary before secondary
(`firstPerSystem`, [System anchors](../astrometry/README.md#system-anchors)),
and is tagged `system_inherited`. Every position is advanced to
`CATALOG_SCENE_EPOCH` (`/src/catalog-format/record/catalog-pure.ts`) before it
is written or chosen as an anchor.

## Gaia photometry

A component with no AT-HYG row but its own Gaia 5p fit takes M_V and B−V from
that Gaia row (`gaia_photometry`), unless the pair partner carries an AT-HYG
row and the same source: Stage 2 copied the partner's blended source onto this
side, and the partner already carries the system's light.

The route: B−V through the Teff of
[Montalto 2021](/data/papers/index.md#montalto2021), fed the observed rather
than the de-reddened colour, and the inverse of
[Ballesteros 2012](/data/papers/index.md#ballesteros2012); V through Riello's
G − V with BP − RP clamped into its range where the catalogue's
`rielloVMagnitude` refuses. Neither is the catalogue's published DR3 transform
(`/scripts/catalog/photometry/colour-index-pure.ts`), and the two disagree on
most rows; adopting the catalogue's is `stellata-hooj.43.1`.

## Counts

`stage6Counts` returns the `multiples` stage's keys of
`../build-binaries-expected.json`, each folded through the one tally helper
(`/scripts/util/counts/tally-pure.ts`); a populated count is the `populated`
bucket of a two-variant fold. `../build-binaries.test.ts` holds them to the
committed snapshot.

## Choices the outputs rest on

The records encode to the committed `multiples.tsv` byte for byte, which
`../build-binaries.test.ts` holds. Three places use arithmetic other than
JavaScript's default: the photocentre's weighted sums are `pySum`, a
compensated sum; the anchor position angle wraps through `pyMod`, the
divisor's sign (both in `../python-float-pure.ts`); and the photocentre walk
visits neighbours in token order.

## What each column carries

`attach-multiples.ts` projects every Stage 2–5 output
into per-component rows. Canonical column order is
`MULTIPLES_COLUMNS`:

```
system_id, comp, hip, gaia_source_id, hd,
x_pc, y_pc, z_pc, absmag, ci, spect, name,
source, regime,
resolve_via, gaia_origin, hip_origin,
astrometry_via, orbit_via, spect_via,
photometry_via, a_via,
orbit_role,
P_days, T_jd, e, a_AU, i_rad, omega_rad, Omega_rad, q, dist_pc,
sep_arcsec, pa_deg, sep_pa_epoch_jd, dmag,
anchor_sep_arcsec, anchor_pa_deg, anchor_comp, mag_pri, mag_sec
```

`x_pc/y_pc/z_pc` are emitted at the **J2016.0** scene epoch:
`positionPc` PM-propagates each component's direction from its native
epoch (`MeasuredAstrometry.refEpoch` — Gaia J2016.0, HIP2 J1991.25,
AT-HYG J1991.25) to `CATALOG_SCENE_EPOCH`, mirroring the single-star
cascade in `scripts/catalog/distance/direction-cascade.ts`. This keeps a promoted
secondary's baked xyz on the same epoch as its primary so the static
relative sep/PA is the pair's true J2016.0 geometry, not corrupted by
(epoch gap × systemic PM). See [Reference epoch](/data/README.md#reference-epoch-and-proper-motion).

`gaia_origin` / `hip_origin` say where the row's Gaia source and HIP came
from, blank exactly when the identifier is: `own`, or `<kind>:<token>` for one
copied from another component of the system — `blend:Aa`, `letter:Aa`,
`parent:A`, `partner:Ca`. Stage 2 records them as it binds
([Identifier origins](../resolve/README.md#identifier-origins)); a standalone
row's SIMBAD identifiers are `own`.

`hd` carries the component's own HD number, with the pair primary
falling back to the coord-validated ORB6 entry's HD (stashed on the
Stage-2 `ResolvedComponent`); counted `multiples_hd_populated`. It is
this pipeline's own designation record for the pair — a record's HD is
the membership manifest's cell, which the catalog build reads there and
amends from nothing ([The identifier columns are read, never re-derived](/scripts/catalog/membership/README.md#the-identifier-columns-are-read-never-re-derived)).
Two other Stage-6 accounting
mechanisms guard silent drops: WDS summary rows duplicated on
(wds_id, discoverer, components) are collapsed at the parse boundary
(`dedupWdsPairRows`, most-observed row wins — Pismis 24 CD carried
two contradictory geometries; counted
`wds_duplicate_pair_rows_dropped`), and Stage-5-kept pairs with no
astrometry and no system anchor — which never reach the TSV — are
counted `multiples_pairs_dropped_no_position` with a capped
`droppedPairSample` build-log sample, mirroring the Stage-5
separation-limit audit line.

The last four columns carry WDS pair geometry — populated on both
component rows of a decomposing pair (standalone rows leave them
empty). `parseWdsSumm` translates two WDS sentinels to None at the
parse boundary so neither reaches downstream consumers. -1 is the
no-measurement sentinel (spectroscopic / interferometric inner pairs
given only at the orbital-element level, Spica) written in both ρ and
θ, so `sep_arcsec` and `pa_deg` both empty. 999.9 is the field-width
overflow marker (ultra-wide pairs whose ρ can't localise the secondary);
only the ρ field overflows, so `sep_arcsec` empties while `pa_deg` keeps
its real angle. Left unhandled the 999.9 ρ baked Alsephina F at
999.9″ × 24.7 pc ≈ 24,695 AU. They feed
companion-promotion's tangent-plane projection for the Tier-3
(no-orbit) path and the runtime binaries.bin sep+PA fields. `sep_pa_epoch_jd` records the
WDS observation year (`date_last`) converted to JD via
`wdsYearToJd`; the runtime `BinaryOrbitField` baselines orbital
animation at this epoch (ΔR(t) = R(t) − R(sep_pa_epoch_jd)) so the
stored placement is reproduced exactly at its measurement date.
`dmag` is the published apparent Δmag
(`mag_sec - mag_pri`) used to impute the companion's absmag when
the secondary row inherits its parent's AT-HYG photometry.
`mag_pri` / `mag_sec` carry the pair row's WDS apparent magnitudes
themselves (both rows; a row's OWN mag is `mag_pri` when it is the
pair primary) — promotion's `wds_mag` absmag path anchors a minted
member's brightness on its own WDS magnitude at the system distance
when neither Δmag path applies.

`anchor_sep_arcsec` / `anchor_pa_deg` carry each component's best WDS
offset from the SYSTEM ANCHOR letter, which `anchor_comp` names on every
row of the system (blank only where the system has no kept pair). The
letter is the most canonical kept-pair primary token, in the same order
companion promotion ranks its WDS-root anchor — but promotion ranks only
primaries it resolves to a catalogue record, so where the top-ranked
primary has no identifier the two anchors differ, and promotion re-bases
every offset onto its own anchor through `anchor_comp`. The offsets are
composed by `computeAnchorOffsets` over a BFS of the system's pair
geometry. A direct measured anchor→component edge
(kept, then Stage-5-rejected) wins over any composed chain — a
blended member sits within measurement error of the anchor, so a
chain through a distant third star cancels to ~zero (Acrux: AC ∘ CB
≡ 0 vs the honest rejected-AB 3.5″); chains then fill in tier order
kept → +rejected → +compound-photocentre-proxy. Rejected rows
contribute geometry only — the pair itself stays dropped; a sep+PA
measurement is real astrometry regardless of boundness
classification. Every tier also links a sub-letter anchor to each
ancestor letter (Aa1 → Aa → A) at the siblings' **photocentre** — the
flux-weighted mean of the sibling positions, weights composed from
each sibling row's own Δm along rows that measured one, starting at
the most canonical sibling, so walk order never changes the weights — because a row naming the parent was
measured off the blend's light centre. So a root anchored on Aa still
reaches everything hung off A (15 Mon J, 31 Cyg H, Matar H). Only the
anchor's chain links: a sub-letter elsewhere (Ca under C) stays
unreached, since where C is a record carrying the blend, an offset for
Ca would let promotion place it beside its own light. A sibling
whose light no row measured weighs nothing, so a missing Ab magnitude
puts A on Aa; an unmeasured sibling separation (ρ = 0 / none) is zero.
Measured against Gaia DR3 over the inner pairs wider than 1″, WDS
outer rows split between the photocentre and Aa itself, at most 0.97″
apart; the photocentre is the one rule for every separation. Blank
only when no chain reaches the component; one reached solely at zero
offset (an unresolved sibling, or A on Aa when Ab's light is unmeasured)
is written `0.000` / `0.00`, so a reader can tell "same place" from "no
measurement". Consumed
by companion promotion's pair-row-primary escape (see
[Companion promotion](/scripts/catalog/companions/README.md#companion-promotion)).

Three system-level mechanisms run at emit time:

- **System-anchor inheritance.** Tight inner binaries (40 Eri B/C inside
  the BC pair, Castor C/D, σ Ori's trapezium components) blend in Gaia
  DR3 and never get per-component 5p fits. `firstPerSystem`
  picks one (x, y, z, dist) tuple per `wds_id` from the first component
  with real astrometry (primary preferred); any component whose own row
  is `unresolved` inherits that anchor and gets `astrometry_via =
  system_inherited`. At parsec scales the offset between inner-binary
  components and the system primary is sub-AU — below any measurable
  effect.
- **Standalone augmentation.** After the pair walk, any
  `(wds_id, component)` SIMBAD has a cross-ID for that isn't already
  emitted gets a standalone row with `orbit_role = standalone` and
  `system_id` prefixed `-_<comp>`. Captures SIMBAD-known components
  WDS doesn't enumerate as a side of any decomposing pair.
- **Mass-ratio q backfill.** When Stage 4 produced orbital elements but
  no `q` (visual ORB6 with no spectroscopic counterpart),
  `massRatioFromComponents` in `../masses/mass-estimate-pure.ts`
  parses both components' spectral strings (SIMBAD per-component
  preferred, AT-HYG inherited fallback) into class / subclass / lum
  class and reads a `q = M_secondary / (M_primary + M_secondary)` off
  per-class mass tables for MS / III / IV / I
  ([Cox 2000](/data/papers/index.md#cox2000) Sect. 15.2; the
  main-sequence anchors, checked against the online table of
  [Mamajek 2022](/data/papers/index.md#mamajek2022) (v2022.04.16), disagree
  with it — A0V 2.9 against 2.18 M☉, K5V 0.65 against 0.70 — and which
  source to adopt is an open decision, `stellata-uadc.69.28`;
  [Pecaut 2013](/data/papers/index.md#pecaut2013) tabulate no masses).
  White dwarfs default to 0.6 M☉; carbon / S / WR
  default to 3.0 M☉; unparseable rows return `None` and `q` stays
  blank.
- **Renderable-element finalization.** After the q backfill,
  `orbitFields` backstops the quantities the runtime's
  `has_orbit` contract requires, for the NON-VISUAL orbit routes only
  (`ESTIMATED_ELEMENT_ORBIT_VIAS` = gaia_nss + orb6_spectroscopic + msc —
  those pairs are sub-resolution, so an estimate can only add motion,
  never contradict a measured WDS placement; estimating for visual
  pairs would widen the baked-vs-R(epoch) disagreement ratchet in
  `/tests/integration/multi-star-regression.test.ts`): `q` ←
  `UNKNOWN_COMPANION_MASS_RATIO_Q` (⅓ — companion at half the
  primary's mass) when no catalog value and no spectral estimate
  exists; `ω` ← π/2 (`CIRCULAR_ORBIT_OMEGA_RAD`) when the fit is
  exactly circular and publishes none — degenerate, not missing, and
  π/2 puts conjunction at T₀ per the eclipser minimum-epoch
  convention; `a_AU` ← Kepler `a³ = M_total·P²` with
  `M_total = M₁/(1−q)` from the primary's spectral-table mass when the
  orbit source published no relative semi-major axis (every NSS
  solution type; ORB6 rows whose a″→AU conversion lacked a parallax).
  The `a_via` column carries the provenance: `catalog` (orbit source
  published it), `kepler_mass_estimate`, or `none`.
  [Multiple-star pipeline](/docs/science-multiple-star-pipeline.md#multiple-star-pipeline)
  carries the error analysis (a ∝ M^⅓).

The `spect` column resolves through a four-tier cascade with
provenance in `spect_via`: `curated` →
`data/binaries/component_sptype_overrides.tsv`, hand-curated
literature types for components no machine source carries (SIMBAD's
WDS cross-IDs never enumerate Algol's Aa2, so its K0IV can only come
from here); `simbad` → SIMBAD's per-component sp_type
(`data/simbad/simbad_wds_sptype.tsv`, joined to the WDS cross-IDs on
`simbad_oid`), which beats
AT-HYG because AT-HYG inherits the same system-level spectral string
across all components (incorrect for mixed-class pairs like Sirius
A0V + DA1.9); `msc` → the MSC's pair-side types, covering the
spectroscopic subsystem members neither SIMBAD nor AT-HYG enumerate
(AR Cas Ab's A6); `athyg` → the inherited per-system string; `none`.
The mass-ratio q backfill reads the resolved `spect`, so a curated or
MSC companion type also improves q for its pair.

`mag_pri` / `mag_sec` (and the derived `dmag`) fall back to the MSC's
pair-side V magnitudes when the WDS row carries none — the
sub-resolution pairs WDS publishes without photometry. Filled pairs
are listed in the build log; counted `msc_pair_mags_filled`.

The `absmag` / `ci` columns resolve with provenance in `photometry_via`:
`athyg_own` (the component's own AT-HYG row); `athyg_system_inherited`
(the AT-HYG row is the system primary's, shared via a single HIP entry —
promotion switches to Δmag imputation); `gaia_photometry` (no AT-HYG
row, but the component's own Gaia 5p source carries G + BP/RP + parallax,
so `gaiaPhotometryAbsmagCi` derives `M_V` from `M_G − (G−V)` and `ci`
from `BP−RP → T_eff → B−V`); `none` (no photometry source). The
`gaia_photometry` path is gated on `astrometry_via = gaia_5p` over the
post-exclusion Gaia astrometry map, plus a partner-share check: when
Stage 2's blend-identity propagation put the partner's source on this
component (both rows carry one source) AND the partner is AT-HYG-backed,
the derivation is suppressed — the partner already carries the system
light, so deriving here would mint a twin. A symmetric blend (neither
component in AT-HYG) still derives the source's COMBINED magnitude;
companion promotion's blend-split post-pass divides it across the
collocated records the source backs (see [Companion promotion](/scripts/catalog/companions/README.md#companion-promotion)).
It recovers the ~3.5k own-DR3 companions that
would otherwise drop at promotion for a blank absmag; see
[Multiple-star pipeline](/docs/science-multiple-star-pipeline.md#multiple-star-pipeline)
(companion promotion) for the transforms and source citations.
