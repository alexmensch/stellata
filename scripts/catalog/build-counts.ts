// The build-catalog count snapshot: its file, its reader, and the diff of a
// BuildCounts record against it. See
// /scripts/catalog/validate/README.md#validation-harness-1.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DistVia } from '../../src/catalog-format/record/catalog-pure.ts';
import { absentStages, flattenStages, stageOfCounts } from '../util/counts/count-stages-pure.ts';
import { REPO_ROOT } from '../util/paths.ts';
import type { RvErrorBandPartition } from './distance/radial-velocity/radial-velocity.ts';
import type { RecuratedBrightness } from './companions/companion-promotion.ts';
import type { CoherenceCounts } from './multiplicity/coherence-lineage-pure.ts';
import type { BrightnessColourCounts } from './photometry/brightness-colour-lineage-pure.ts';
import type { InputsCounts } from './parse/read-stars-inputs.ts';
import type { FiguresCounts } from './parse/constellations/constellations.ts';
import type { BoundariesCounts } from './boundaries/build-boundaries-artifact.ts';
import type { SearchCounts } from './record/search-index-pure.ts';
import type { GcvsCounts } from './parse/gcvs/gcvs-parse.ts';
import type { MultiplicityCounts } from './multiplicity/multiplicity-stage-pure.ts';
import type { RecordsCounts } from './record/records-stage-pure.ts';
import type { NamingCounts } from './naming/naming-lineage-pure.ts';
import type { NamingDerivedCounts } from './naming/display-names.ts';

/** Repo-relative path of the snapshot `BuildCounts` is pinned against, so the
 *  build and every consumer that reads the shipped figures back resolve one
 *  path. The generic comparator below is reused with other snapshots. */
export const BUILD_COUNTS_EXPECTED_FILE = 'scripts/catalog/build-catalog-expected.json';

/** The committed snapshot's figures: what the catalogue build last pinned. */
export function committedBuildCounts(): BuildCounts {
  return flattenStages(JSON.parse(readFileSync(resolve(REPO_ROOT, BUILD_COUNTS_EXPECTED_FILE), 'utf8'))) as BuildCounts;
}

/** Every count the snapshot holds, by name: the filed counts and each composed stage's block. */
export type BuildCounts = FiledCounts & InputsCounts & BrightnessColourCounts & CoherenceCounts & MultiplicityCounts & GcvsCounts
  & NamingCounts & NamingDerivedCounts & RecordsCounts & SearchCounts & BoundariesCounts & FiguresCounts;

/** The counts of the stages not yet composed of a count block, each filed under its stage by CATALOG_COUNT_STAGE. */
export interface FiledCounts {
  /** Rows the Bailer-Jones override is allowed to fire on: a Gaia DR3
   *  source_id present AND the parallax cascade resolved `gaia_dr3_inversion`
   *  (the Gaia inverse-parallax population the posterior is the principled
   *  replacement for). Rows on any other tier are excluded — their distance
   *  isn't a Gaia inverse and B-J would silently move them to the prior's
   *  distant tail at low parallax S/N. */
  bjEligible: number;
  /** bjEligible rows whose source_id was also in the B-J catalogue —
   *  the count actually overridden. Coverage = bjOverridden / bjEligible. */
  bjOverridden: number;
  /** Rows whose resolved direction falls inside the LMC sky cone — the
   *  population the LMC kinematic PM gate is evaluated against. */
  lmcCandidates: number;
  /** Rows that ALSO pass the LMC bulk-PM gate; their dist/x/y/z/absmag
   *  were snapped to Pietrzyński 2019's
   *  (/data/papers/index.md#pietrzynski2019) eclipsing-binary distance. */
  lmcOverridden: number;
  /** Cone + PM matches the snap refuses on their own parallax, split by the
   *  tier they keep. See distance/refinement/README.md#layer-2--lmc-kinematic-override. */
  lmcParallaxRefusedByDistVia: Record<DistVia, number>;
  /** lmcOverridden split by the distance tier the snap displaced — B-J's
   *  posterior or the raw inversion on most rows; the split states which
   *  populations the override actually moves. */
  lmcOverriddenByDistVia: Record<DistVia, number>;
  /** Pair rows in multiples.tsv scanned by the companion-promotion pass
   *  (excludes standalone rows). */
  companionRowsScanned: number;
  /** Newly minted catalog records — companions whose identifier wasn't
   *  already a record and that survived the position + absmag gates. */
  companionPromoted: number;
  /** Subset of `companionPromoted` addressable only via a synthetic
   *  identifier (`synth-<wds_id>-<comp>`) because the row carried no
   *  own Gaia source_id and no non-inherited HIP. Algol Aa,Ab + Aa1,2's
   *  Ab / Aa2 sit here. */
  companionPromotedSynthetic: number;
  /** Pair rows whose identifier already resolved to an existing
   *  catalog row (most pair rows fall here — the brighter component is
   *  almost always a record already). */
  companionAlreadyInCatalog: number;
  /** Pair rows dropped because neither the secondary's own astrometry
   *  nor sep+PA tangent projection from the primary yielded a 3D
   *  position. */
  companionDroppedNoPosition: number;
  /** Pair rows dropped because the tangent projection ρ·d exceeds the
   *  bound-pair tidal limit — a fabricated companion that far can't be
   *  gravitationally bound (a line-of-sight optical double with no
   *  parallax for Stage 5 to catch). */
  companionDroppedBeyondTidalLimit: number;
  /** Pair rows dropped because the secondary's absmag couldn't be
   *  imputed — no own absmag AND no primary+Δmag combo. */
  companionDroppedNoAbsmag: number;
  /** Pair rows dropped because the secondary's comp letter is a WDS
   *  unresolved compound (e.g. "BC" / "AB" / "ABC") whose constituent
   *  single-letter components are already resolved as sibling cursors
   *  in the same WDS root. The aggregate isn't a single star and would
   *  double-count its components if promoted. */
  companionDroppedCompoundComp: number;
  /** Pair-row primaries dropped because no position was derivable —
   *  neither own per-component astrometry nor a compound-sibling sep+PA
   *  proxy — so collocating on the anchor would render a false
   *  coincident star (Alsephina C). */
  companionDroppedCollocatedPrimary: number;
  /** Pair rows whose ids resolved onto the anchor record while the naming
   *  authority already letters that record as the row's own component: the
   *  pair's two ends are one star, so minting would bake a twin and the
   *  pair's orbit would animate a star against its own copy. Ratchets down —
   *  each is a mis-keyed multiples.tsv row upstream. */
  companionAnchorIsComponent: number;
  /** Pair rows refused because the record they name is parked with no owned
   *  parallax — promoting would re-serve the measurement the cascade
   *  refused. */
  companionDroppedParkedRecord: number;
  companionDroppedParkedViaGaia5p: number;
  companionDroppedParkedOwnedFit: number;
  /** Promoted secondaries whose absmag came from the class→M_V
   *  spectral calibration (inherited/missing photometry, no WDS Δmag,
   *  per-component spect_via=curated/simbad). */
  companionAbsmagSpectralDerived: number;
  /** Promoted records whose spectral info was re-derived as a
   *  main-sequence estimate from the component's own de-extincted
   *  absmag (spect_via inherited/blank + an own-brightness absmag
   *  source) — the hot-but-tiny inherited-type population (Algol Ab,
   *  Acrab B, Acrux B). */
  companionSpectMsFromOwnAbsmag: number;
  /** Promoted records whose absmag came from the row's own WDS
   *  apparent magnitude at the system distance (both Δmag paths
   *  unavailable, or an escape row whose "own" photometry is the
   *  anchor's blend — Acrux B). */
  companionAbsmagWdsMagDerived: number;
  /** Promoted pair-row-primary escapes whose absmag fell back to the
   *  anchor's collocated brightness (imputeCompanionAbsmag). Ratchet DOWN
   *  by curating white-dwarf absmags. */
  companionAbsmagAnchorCollocated: number;
  /** Promoted secondaries still carrying the inherited primary absmag
   *  (full-luminosity twin) — kept only because the pair has a
   *  renderable orbit binaries.bin must keep addressing. Ratchet DOWN
   *  by curating per-component types; an increase is a regression. */
  companionAbsmagInheritedTwinOrbital: number;
  /** Promoted gaia_photometry records whose absmag was reduced by the
   *  blend-split post-pass — N≥2 collocated records sharing one Gaia
   *  source (an unresolved sub-arcsec pair) each fainter than the derived
   *  combined magnitude by 2.5·log10(N). YY Gem Ca/Cb is the showcase. */
  companionBlendSplit: number;
  /** Anchor records dimmed by the flux-conservation post-pass: a synth
   *  member with anchor-inherited-then-stripped ids took a wds_mag/dmag
   *  absmag, so its flux is subtracted from the anchor's athyg_own blend
   *  magnitude and total system light is conserved. */
  companionBlendDimmedAnchors: number;
  /** Non-structural dim candidates the subset solve could not fit (no
   *  observed WDS mags / distance) — left un-dimmed. */
  companionBlendDimUnfit: number;
  /** Non-structural dim candidates the winning subset left out, or whose
   *  fit was indecisive within the decisive margin — their light is not in
   *  the anchor's blend. */
  companionBlendDimOutside: number;
  /** Dim candidates Gaia had already resolved out of the anchor's magnitude:
   *  the member carries its own DR3 source_id and the anchor's V came from
   *  Gaia's, so its light was never in there. Rises with Gaia coverage. */
  companionBlendDimGaiaResolved: number;
  /** Dim candidates wider than the anchor tier's blending scale, or carrying no
   *  published separation at all — no entry of that catalogue sums both. */
  companionBlendDimBeyondSeparation: number;
  /** Dim candidates whose winning hypothesis still missed the anchor's observed
   *  magnitude by more than the input's error scale — matched nothing. */
  companionBlendDimMisfit: number;
  /** Dim candidates skipped by the M_member > M_blend + 0.05 guard. */
  companionBlendDimSkipped: number;
  /** Existing blend-coordinate double entries repositioned in
   *  place by companion promotion (ξ UMa B class). */
  companionRepositionedCollocatedDouble: number;
  /** companions/README.md#overlap-gate. */
  physicalOverlaps: number;
  /** Promoted companions whose own IAU-positional constellation differs from
   *  their anchor's — a pair wide enough to straddle a boundary, which
   *  inheriting the anchor's index used to hide. */
  companionConstellationSplitFromAnchor: number;
  /** Existing records a pair row resolved to that took the anchor's
   *  designation constellation, carrying none of their own. */
  companionExistingDesigConFromAnchor: number;
  /** Existing records whose own 5p solution Gaia rejects, re-curated onto the
   *  pair's measured geometry and the anchor's systemic velocity, per where
   *  the brightness came from (Sirius B is `dmag_imputed`). */
  companionExistingMemberRecurated: Record<RecuratedBrightness, number>;
  /** Synthetic mints refused because a stored same-as edge bridges the key to
   *  a Gaia source the catalogue already holds — without it one physical star
   *  ships twice. Ratchets DOWN. */
  companionExistingViaSameasBridge: number;

  /** Distance cascade: the parallax tier each record's distance inverts,
   *  before the two override layers. `distNone` is the membership-parity ledger drop (/docs/catalog-driver.md#6-parity--the-gate-on-any-membership-change) —
   *  records no owned parallax reaches, which do not ship. */
  distBailerJones: number;
  distLmcKinematic: number;
  distGaiaDr3Inversion: number;
  distHip2Parallax: number;
  distCns5Plx: number;
  distGliesePlx: number;
  distSimbadPlx: number;
  /** Records placed by a V/70A photometric or spectroscopic parallax — a
   *  distance from colour and spectral type rather than astrometry, which is
   *  why it is its own tier below every bibcoded measurement of the star and
   *  why it is counted apart. Ratchet DOWN: each of these is a record waiting
   *  for someone to measure its parallax. */
  distGliesePhotometricPlx: number;
  distPairMemberParallax: number;
  distCurated: number;
  distNone: number;
  /** Rows whose SHIPPED distance inverts a parallax with worse than 20%
   *  fractional error, so the result is biased. Bailer-Jones 2021
   *  (/data/papers/index.md#bailerjones2021) rows are excluded:
   *  there the posterior, not the inversion, handles the low-S/N case.
   *
   *  These rows have no second source, so refusing one would cost it its record
   *  rather than its precision — this count is how the population stays visible
   *  for a Gaia DR4 revisit instead of dissolving into the catalogue. Recompute
   *  the set at any time as `plx / e_plx < PARALLAX_LOW_PRECISION_SN` over the
   *  non-Bailer-Jones tiers. */
  distLowPrecisionParallax: number;
  /** The record-parity parks (/docs/catalog-driver.md#61-record-parity), per reason — rows that reach no parallax, no V, or no
   *  position and so build no record. They are in no cascade partition: those
   *  run over records, and a parked row is not one. `refused_*` against
   *  `no_parallax_published` is the residual policy (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) counting a refused
   *  measurement apart from an absent one. */
  parkedRefusedNoDefensibleParallax: number;
  parkedNoParallaxPublished: number;
  parkedNoVMagnitude: number;
  parkedNoPosition: number;
  /** Direction cascade: rows whose sky direction came from a clean
   *  Gaia DR3 5p solution. */
  directionGaia5p: number;
  /** Direction cascade: Gaia 2p position-only rows with no HIP2 cover. */
  directionGaia2p: number;
  /** Direction cascade: Gaia rows with an NSS orbit AND an unreliable
   *  5p fit — same Gaia values, tagged as the binaries pipeline's Stage 3
   *  tags them (`gaia_nss_systemic`). */
  directionGaiaNssSystemic: number;
  /** Direction cascade: rows with no usable Gaia parallax (saturated
   *  bright set / 2p solutions) whose direction came from HIP2. */
  directionHip2Saturated: number;
  /** Direction cascade: rows whose Gaia-vs-HIP2 PM disagreement
   *  (> 50 mas/yr on either axis) routed the direction to HIP2. */
  directionHip2PmDiscrepant: number;
  /** Direction cascade: rows Gaia and HIP2 both miss, placed at Tycho-2's
   *  own mean position propagated to the scene epoch from its per-star,
   *  per-coordinate mean epochs. */
  directionTycho2: number;
  /** The `directionTycho2` subset with no mean solution at all, placed at the
   *  row's J2000 `ra_icrs` cell instead. Those rows carry no Tycho-2 PM
   *  either, so the position is unpropagated unless another tier rescues a
   *  PM for it — the residual the per-field cascades (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) require enumerated rather than implied. */
  directionTycho2FromIcrs: number;
  /** The `directionTycho2` subset whose mean solution is an unresolved
   *  double's photocentre (`pflag='P'`) rather than one star's place, so the
   *  position is the pair's light-centre. Counted, not gated: no tier sits
   *  below this one for a TYC-keyed row, so gating would cost each its record.
   *  The V side of the same row is marked a system blend for this reason. */
  directionTycho2Photocentre: number;
  /** Direction cascade: TYC-less Gliese rows placed at CNS5's own
   *  coordinates, propagated from the row's own `pos_epoch`. */
  directionCns5: number;
  /** Direction cascade: the bottom tier — rows no first-order catalogue
   *  reaches, placed at SIMBAD's bibcoded J2000 coordinates propagated to
   *  the scene epoch. Sol is NOT here: it has no direction at all. */
  directionSimbad: number;
  /** Direction cascade: Sol, whose curated tier exists because it carries no
   *  identifier any tier above can key on. Pinned at 1. */
  directionCurated: number;
  /** Space-motion velocity: rows whose tangential velocity came from
   *  Gaia DR3 5p PM (the dominant set; tracks directionGaia5p +
   *  directionGaiaNssSystemic). */
  velocityGaiaPm: number;
  /** Space-motion velocity: rows whose PM came from HIP2 (the
   *  hip2_saturated + hip2_pm_discrepant tiers with a usable HIP2 PM). */
  velocityHip2Pm: number;
  /** Space-motion velocity: rows whose PM came from Tycho-2 — its own
   *  direction tier plus the rescue cascade's `pmRescueTycho2`. */
  velocityTycho2Pm: number;
  /** Space-motion velocity: rows whose PM came from CNS5, both routes. */
  velocityCns5Pm: number;
  /** Space-motion velocity: rows whose PM came from a bibcoded SIMBAD
   *  `pmra`/`pmdec`, both routes. */
  velocitySimbadPm: number;
  /** Space-motion velocity: rows with no usable PM from any source —
   *  zero tangential velocity (Sol, the rows the rescue cascade leaves at
   *  `pmRescueGaiaBibcodeSkipped` / `pmRescueNone`, and the artifact rows the
   *  sanity ceiling zeroed). */
  velocityZero: number;
  /** PM rescue: rows the direction tier left without a proper motion whose
   *  own TYC reaches a Tycho-2 mean solution. The cascade's top tier and its
   *  only one needing no bibcode check — Tycho-2 predates Gaia
   *  (`distance/README.md#the-proper-motion-rescue-cascade`). */
  pmRescueTycho2: number;
  /** PM rescue: rows reached by CNS5 on their own GJ, whose PM cites the
   *  literature rather than a Gaia release. */
  pmRescueCns5: number;
  /** PM rescue: rows reached by a bibcoded SIMBAD PM citing the literature —
   *  the second-order bottom tier. */
  pmRescueSimbad: number;
  /** PM rescue: 2p rows whose only owned PM cites a Gaia release, refused so
   *  the pull cannot return the motion DR3 declined to fit. They take a zero
   *  tangential term; the cost is enumerated in the README. */
  pmRescueGaiaBibcodeSkipped: number;
  /** PM rescue: rows no owned PM source reaches at all. Distinct from the
   *  skipped bucket — nothing was refused, there is nothing there. */
  pmRescueNone: number;
  /** Rows whose computed space velocity exceeded VELOCITY_SANITY_CEILING
   *  (PM×distance artifact) and was zeroed — a subset of velocityZero. */
  velocityClamped: number;
  /** Kept rows above the Galactic escape velocity `GALACTIC_ESCAPE_VELOCITY_KM_S`. Unbound
   *  stars are genuinely exceptional, so this band is almost all PM×distance
   *  / bad-RV artifacts — tracked as a ratchet (not clamped) so a proven
   *  hypervelocity star survives and the artifact tail stays visible for
   *  finer filtering. */
  velocityAboveEscape: number;
  /** Rows whose velocity carries a non-zero radial velocity from either
   *  rv tier below. */
  velocityRvApplied: number;
  /** Rows taking the radial term from Gaia DR3 `radial_velocity`. */
  rvGaiaDr3: number;
  /** Rows RVS did not reach, taking a bibcoded SIMBAD `rvz_radvel`. */
  rvSimbad: number;
  /** `rvSimbad` rows whose bibcode is a Gaia catalogue release rather than
   *  the literature — legitimate here (Gaia published no rv of its own for
   *  them), and the split the skip rule's own cohort is measured against. */
  rvSimbadGaiaBibcode: number;
  /** Rows whose own 5p gate withheld a Gaia rv AND whose SIMBAD candidate
   *  cited a Gaia release — the skip rule's catch, falling to zero rather
   *  than laundering the withheld value back in. */
  rvGaiaBibcodeSkipped: number;
  /** Rows no tier covers — the radial term is zero. */
  rvNone: number;
  /** Rows whose resolved radial term alone exceeded
   *  `VELOCITY_SANITY_CEILING_KM_S` and was dropped, leaving the measured
   *  proper motion in place rather than losing it to the whole-vector clamp
   *  (`distance/radial-velocity/README.md#the-sanity-thresholds-are-the-filter-on-a-bad-simbad-value`). Counted
   *  under the tier that supplied the value — the cascade routed correctly
   *  and the threshold, not the cascade, rejected it. */
  rvRadialRejected: number;
  /** `rvGaiaDr3` rows split by the stated `radial_velocity_error`, a tracked
   *  ratchet rather than a gate — DR3 is taken as published
   *  (`distance/radial-velocity/README.md`). `none` is pinned at 0: the
   *  published catalogue always pairs an rv with an error. */
  rvGaiaErrorBands: RvErrorBandPartition;
  /** Largest stated `radial_velocity_error` (km/s) any `rvGaiaDr3` row
   *  carries. Below DR3's own publication ceiling of 40 by construction; a
   *  refresh that moves it forces this snapshot to be reviewed. */
  rvGaiaErrorMaxKmS: number;
}

/** The snapshot's stage order, the build's pipeline order; its lineage stages keep LINEAGE_STAGES' order. */
export const CATALOG_COUNT_STAGES = [
  'inputs', 'placement', 'brightness-colour', 'coherence', 'promotion',
  'multiplicity', 'gcvs', 'naming', 'records', 'search', 'boundaries', 'figures',
] as const;
export type CatalogCountStage = (typeof CATALOG_COUNT_STAGES)[number];

/** The stage each filed count sits under in the snapshot: the step that computes it. */
export const CATALOG_COUNT_STAGE: Readonly<Record<keyof FiledCounts, CatalogCountStage>> = {
  bjEligible: 'placement',
  bjOverridden: 'placement',
  lmcCandidates: 'placement',
  lmcOverridden: 'placement',
  lmcParallaxRefusedByDistVia: 'placement',
  lmcOverriddenByDistVia: 'placement',
  distBailerJones: 'placement',
  distLmcKinematic: 'placement',
  distGaiaDr3Inversion: 'placement',
  distHip2Parallax: 'placement',
  distCns5Plx: 'placement',
  distGliesePlx: 'placement',
  distSimbadPlx: 'placement',
  distGliesePhotometricPlx: 'placement',
  distPairMemberParallax: 'placement',
  distCurated: 'placement',
  distNone: 'placement',
  distLowPrecisionParallax: 'placement',
  parkedRefusedNoDefensibleParallax: 'placement',
  parkedNoParallaxPublished: 'placement',
  parkedNoVMagnitude: 'placement',
  parkedNoPosition: 'placement',
  directionGaia5p: 'placement',
  directionGaia2p: 'placement',
  directionGaiaNssSystemic: 'placement',
  directionHip2Saturated: 'placement',
  directionHip2PmDiscrepant: 'placement',
  directionTycho2: 'placement',
  directionTycho2FromIcrs: 'placement',
  directionTycho2Photocentre: 'placement',
  directionCns5: 'placement',
  directionSimbad: 'placement',
  directionCurated: 'placement',
  velocityGaiaPm: 'placement',
  velocityHip2Pm: 'placement',
  velocityTycho2Pm: 'placement',
  velocityCns5Pm: 'placement',
  velocitySimbadPm: 'placement',
  velocityZero: 'placement',
  pmRescueTycho2: 'placement',
  pmRescueCns5: 'placement',
  pmRescueSimbad: 'placement',
  pmRescueGaiaBibcodeSkipped: 'placement',
  pmRescueNone: 'placement',
  velocityClamped: 'placement',
  velocityAboveEscape: 'placement',
  velocityRvApplied: 'placement',
  rvGaiaDr3: 'placement',
  rvSimbad: 'placement',
  rvSimbadGaiaBibcode: 'placement',
  rvGaiaBibcodeSkipped: 'placement',
  rvNone: 'placement',
  rvRadialRejected: 'placement',
  rvGaiaErrorBands: 'placement',
  rvGaiaErrorMaxKmS: 'placement',
  companionRowsScanned: 'promotion',
  companionPromoted: 'promotion',
  companionPromotedSynthetic: 'promotion',
  companionAlreadyInCatalog: 'promotion',
  companionDroppedNoPosition: 'promotion',
  companionDroppedBeyondTidalLimit: 'promotion',
  companionDroppedNoAbsmag: 'promotion',
  companionDroppedCompoundComp: 'promotion',
  companionDroppedCollocatedPrimary: 'promotion',
  companionAnchorIsComponent: 'promotion',
  companionDroppedParkedRecord: 'promotion',
  companionDroppedParkedViaGaia5p: 'promotion',
  companionDroppedParkedOwnedFit: 'promotion',
  companionAbsmagSpectralDerived: 'promotion',
  companionSpectMsFromOwnAbsmag: 'promotion',
  companionAbsmagWdsMagDerived: 'promotion',
  companionAbsmagAnchorCollocated: 'promotion',
  companionAbsmagInheritedTwinOrbital: 'promotion',
  companionBlendSplit: 'promotion',
  companionBlendDimmedAnchors: 'promotion',
  companionBlendDimSkipped: 'promotion',
  companionBlendDimUnfit: 'promotion',
  companionBlendDimOutside: 'promotion',
  companionBlendDimGaiaResolved: 'promotion',
  companionBlendDimBeyondSeparation: 'promotion',
  companionBlendDimMisfit: 'promotion',
  companionRepositionedCollocatedDouble: 'promotion',
  physicalOverlaps: 'promotion',
  companionConstellationSplitFromAnchor: 'promotion',
  companionExistingDesigConFromAnchor: 'promotion',
  companionExistingMemberRecurated: 'promotion',
  companionExistingViaSameasBridge: 'promotion',
};

export type CountDiff =
  | { key: string; status: 'match'; value: number }
  | { key: string; status: 'mismatch'; expected: number; actual: number }
  | { key: string; status: 'moved'; value: number; from: string; to: string }
  | { key: string; status: 'absent-from-snapshot'; actual: number }
  | { key: string; status: 'absent-from-build'; expected: number }
  /** A stage one side records as absent (its input was missing) and the other counted; `key` is the stage. */
  | { key: string; status: 'absent-input'; side: 'build' | 'snapshot' };

/** Staged snapshots: ../util/counts/README.md.
 *  Partition-valued entries (a `Record<tier, number>`) expand to one
 *  `parent.bucket` row each, so a single drifting bucket names itself.
 *  Walks the union of both sides' rows: a count the build stopped
 *  producing is as much drift as one the snapshot never had. Rows come in
 *  the actual object's order, then the snapshot-only ones. Pure — no I/O.
 *
 *  Generic over the count record so any build script's snapshot can use it
 *  (`BuildCounts` here, `OverlayJoinCounts` in `classic-ids/`); the
 *  walk only needs each value to be a number or a flat number partition. */
export function compareBuildCounts<T extends object>(
  expected: T,
  actual: T,
): CountDiff[] {
  const e = flattenCounts(expected);
  const a = flattenCounts(actual);
  const eStage = stageOfCounts(expected);
  const aStage = stageOfCounts(actual);
  const eAbsent = absentStages(expected);
  const aAbsent = absentStages(actual);
  const diff: CountDiff[] = [];
  for (const [key, { n: av, count }] of a) {
    const ev = e.get(key)?.n;
    const from = eStage?.get(count);
    const to = aStage?.get(count);
    if (ev === undefined && to !== undefined && eAbsent.has(to)) continue;
    if (ev === undefined) diff.push({ key, status: 'absent-from-snapshot', actual: av });
    else if (ev !== av) diff.push({ key, status: 'mismatch', expected: ev, actual: av });
    else if (from !== undefined && to !== undefined && from !== to) diff.push({ key, status: 'moved', value: av, from, to });
    else diff.push({ key, status: 'match', value: av });
  }
  for (const [key, { n: ev, count }] of e) {
    const from = eStage?.get(count);
    if (!a.has(key) && !(from !== undefined && aAbsent.has(from))) diff.push({ key, status: 'absent-from-build', expected: ev });
  }
  for (const stage of aAbsent) if (!eAbsent.has(stage)) diff.push({ key: stage, status: 'absent-input', side: 'build' });
  for (const stage of eAbsent) if (!aAbsent.has(stage)) diff.push({ key: stage, status: 'absent-input', side: 'snapshot' });
  return diff;
}

/** Each row with the count it belongs to: a partition's buckets share their parent's. */
function flattenCounts(counts: object): Map<string, { n: number; count: string }> {
  const rows = new Map<string, { n: number; count: string }>();
  for (const [count, value] of Object.entries(flattenStages(counts) as Record<string, unknown>)) {
    if (typeof value === 'number') {
      rows.set(count, { n: value, count });
      continue;
    }
    if (value === null || typeof value !== 'object') {
      throw new Error(`count ${count} is ${JSON.stringify(value)}, not a number or a partition`);
    }
    for (const [bucket, n] of Object.entries(value as Record<string, number>)) {
      rows.set(`${count}.${bucket}`, { n, count });
    }
  }
  return rows;
}

/** One-line `bucket=n` rundown of a row partition, zeros included — the
 *  per-partition dry-run figure an override PR quotes. */
export function formatPartition(partition: Readonly<Record<string, number>>): string {
  return Object.entries(partition).map(([b, n]) => `${b}=${n}`).join(', ');
}

type DriftedRow = Exclude<CountDiff, { status: 'match' }>;

export function driftedRows(diff: CountDiff[]): DriftedRow[] {
  return diff.filter((d): d is DriftedRow => d.status !== 'match');
}

/** Only drifted rows are listed, so a fatal exit doesn't scroll the
 *  actionable ones off-screen. */
export function formatCountDiff(diff: CountDiff[]): string {
  const drifted = driftedRows(diff);
  if (drifted.length === 0) return `build-counts: all ${diff.length} counts match`;
  const width = Math.max(...drifted.map((d) => d.key.length));
  const lines = [`build-counts: ${drifted.length} of ${diff.length} counts differ`];
  for (const d of drifted) {
    const label = `  ${d.key.padEnd(width)}`;
    switch (d.status) {
      case 'absent-from-snapshot':
        lines.push(`${label} absent from snapshot, got ${d.actual}`);
        break;
      case 'absent-from-build':
        lines.push(`${label} expected ${d.expected}, absent from build`);
        break;
      case 'moved':
        lines.push(`${label} ${d.value} moved from stage ${d.from} to ${d.to}`);
        break;
      case 'absent-input':
        lines.push(`${label} stage's input is absent from the ${d.side}, counted in the ${d.side === 'build' ? 'snapshot' : 'build'}`);
        break;
      case 'mismatch': {
        const delta = d.actual - d.expected;
        const sign = delta > 0 ? '+' : '';
        lines.push(`${label} expected ${d.expected}, got ${d.actual} (${sign}${delta})`);
        break;
      }
    }
  }
  return lines.join('\n');
}

/** The `compare` every count snapshot passes to `snapshotCheck`. */
export function compareCountSnapshot<T extends object>(
  expected: T,
  actual: T,
): { drifted: boolean; report: string } {
  const diff = compareBuildCounts(expected, actual);
  return {
    drifted: driftedRows(diff).length > 0,
    report: formatCountDiff(diff),
  };
}
