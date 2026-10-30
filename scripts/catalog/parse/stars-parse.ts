// Membership-manifest reader: per-row parallax cascade + its two override
// layers × direction cascade → in-memory Star records for every downstream
// builder step. See scripts/catalog/README.md.

import {
  apparentToAbsoluteMagnitude,
  SOL_ABSOLUTE_V_MAGNITUDE,
  SOL_APPARENT_V_MAGNITUDE,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  NO_CONSTELLATION_INDEX,
  SIMBAD_NAMESPACE_VALUES,
  SOLAR_BV_FALLBACK,
  type ApsisRow,
  type SimbadNamespace,
  type SimbadRecordKeys,
} from '../record/catalog-pure';
import { classifyFromSimbad, SPECTRAL_UNKNOWN } from '../spectral/spectral-classify';
import {
  type SimbadSpectralIndex,
  type SpectralResolution,
  type SpectralVia,
  emptySimbadSpectralIndex,
  resolveSpectralInfo,
  SPECTRAL_VIA_VALUES,
} from '../spectral/spectral-resolve';
import {
  physicalRadius,
  resolveApsisTeff,
  spectralClassCi,
  spectralClassColorIsDerivable,
} from '../spectral/physical-radius';
import {
  resolveDirection,
  directionOnPm,
  velocityPcPerYr,
  DIRECTION_VIA_VALUES,
  VELOCITY_VIA_VALUES,
  KM_S_TO_PC_YR,
  VELOCITY_SANITY_CEILING_PC_YR,
  GALACTIC_ESCAPE_VELOCITY_PC_YR,
  type DirectionSources,
  type DirectionVia,
  type VelocityVia,
} from '../distance/direction-cascade';
import { lookupCns5Astrometry } from '../classic-ids/classic-ids-parse';
import { isGaiaCatalogueBibcode } from '../distance/gaia-distrust';
import {
  isLowPrecisionParallax,
  resolveParallax,
  DIST_VIA_VALUES,
  type DistVia,
} from '../distance/parallax/parallax-cascade';
import {
  PARKED_REASONS,
  type ParkedIdentifiers,
  type ParkedReason,
  type ParkedRecord,
} from '../distance/parallax/parked-ledger';
import {
  parkedRecord,
  type BailerJonesStep,
  type LmcStep,
  type Placement,
} from '../distance/placement-lineage-pure';
import {
  emptyPairMemberParallaxIndex,
  lookupPairMemberParallax,
  type PairMemberParallaxIndex,
} from '../distance/parallax/pair-member-parallax';
import {
  resolvePmRescue,
  PM_RESCUE_OUTCOMES,
  pmRescueOutcome,
  VELOCITY_VIA_BY_PM_RESCUE,
  type PmRescueOutcome,
} from '../distance/pm-rescue/pm-rescue';
import {
  radialTermExceedsCeiling,
  resolveRadialVelocity,
  rvErrorBand,
  RV_VIA_VALUES,
  RV_ERROR_BANDS,
  type RvVia,
  type RvErrorBand,
} from '../distance/radial-velocity/radial-velocity';
import { R_V, avSolToStar, type DustGrid } from '../distance/dust/dust-deextinction-pure';
import {
  emptySimbadValueIndex,
  lookupSimbadValues,
  type SimbadValueIndex,
} from '../simbad/simbad-values-parse';
import {
  printedV,
  printedVLookups,
  resolveVMagnitude,
  V_VIA_VALUES,
  type VVia,
} from '../photometry/v-magnitude-pure';
import {
  emptyGlieseIndex,
  lookupGliese,
  type GlieseIndex,
} from '../gliese-parse';
import {
  ciIsObserved,
  resolveColourIndex,
  CI_VIA_VALUES,
  type CiVia,
} from '../photometry/colour-index-pure';
import type { GspcColour } from '../photometry/gspc-parse';
import { printedByHip } from '../photometry/hip-photometry-parse';
import { emptyTallyPartition } from '../../util/tally';
import type { ManifestRecord } from '../membership/membership-manifest-tsv';
import { type ConstellationAssignment } from './constellations/constellations';
import {
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  isBailerJonesEligible,
  isInLmcCone,
  type BailerJonesIndex,
} from '../distance/refinement/distance-overrides-pure';

// A row still farther than this after every override fails the walk. Every
// kinematic-override target distance must stay below it or its population
// fails here — distance/refinement/distance-overrides-pure.test.ts pins
// LMC_DISTANCE_PC < MAX_DIST_PC.
export const MAX_DIST_PC = 50_000;

export interface Star {
  x: number; y: number; z: number;
  /** Space-motion velocity, equatorial Cartesian pc/yr (Sol at origin).
   *  Written to catalog.bin v8; the runtime epoch-advance pass reads it
   *  once at load to propagate positions off the J2016.0 baseline. Pair
   *  members share one systemic velocity so the advance never shears a
   *  pair (see companion-promotion's systemic-velocity pass). */
  vx: number; vy: number; vz: number;
  absmag: number;
  ci: number;
  spectClass: number;
  lumClass: number;
  physicalRadius: number;  // solar radii
  /** IAU-positional membership, computed from this record's own resolved
   *  position — catalog byte 34. Only Sol carries
   *  `NO_CONSTELLATION_INDEX`: it sits at the origin and has no direction. */
  conIndex: number;
  /** The constellation this star's designation is named for — editorial, not
   *  positional, so it diverges from `conIndex` where a boundary has since
   *  moved past the star. `NO_CONSTELLATION_INDEX` when unknown, in which case
   *  designations fall back to `conIndex`. Filled downstream of this walk:
   *  the IAU WGSN designation the naming ladder resolves states it, else
   *  IV/27A keyed on HD/HIP, else a GCVS designation's own trailing
   *  abbreviation. See ./constellations/README.md#positional-constellation-membership. */
  desigConIndex: number;
  flags: number;
  /** The record's display name — what `catalog.bin`'s name table carries.
   *  The manifest's printed cell until the naming ladder runs, then the
   *  composer's output for the NAME tiers only; a record displaying a
   *  designation carries null and the runtime composes its label from the
   *  structure below (`../naming/README.md`). */
  proper: string | null;
  /** IAU WGSN approved name — the ladder's authority tier. */
  iauName: string | null;
  /** A published designation no structured source states, carried as a
   *  string (`Ross 128`, `Cygnus X-1`) — /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them. */
  eponym: string | null;
  /** Bayer letter as the Unicode glyph — Greek (`α`) or the bare Latin
   *  overflow series (`p`). The manifest's ASCII cell (`Alp`) until the naming
   *  ladder replaces it; no consumer parses it either way. */
  bayer: string | null;
  bayerSup: number | null;
  /** `κ Her` names component A, so NEC's row for the B component states it —
   *  and the letter then renders unconditionally, where a WDS letter renders
   *  only to break a tie (/docs/star-naming.md#3-the-ladder). */
  bayerComponent: string | null;
  gould: number | null;
  /** Serpens' Gould halves are numbered separately (`4 G. Ser Cau`). */
  gouldHalf: string | null;
  /** Published spellings that resolve a search and never display — a name
   *  the ladder displaced, or an approved alternate. Only strings no
   *  structure implies (/docs/star-naming.md#5-aliases--ship-what-cannot-be-derived-derive-what-can). */
  aliases: string[];
  hip: number | null;
  hd: number | null;
  hr: number | null;
  /** Further HD / HR numbers naming this star — the manifest's `hd_alt` /
   *  `hr_alt` cells, which the classic-ID label merge filled where an overlay
   *  cell asserted more than the field could hold
   *  (`../classic-ids/label-merge/README.md`). Never written to the
   *  binary: they reach the runtime through the search index and the SID
   *  ledger through `starDesignations`. */
  hdAlt: number[];
  hrAlt: number[];
  flam: number | null;
  gl: string | null;
  /** Tycho-2 designation. Build-time only — never written to the binary; it
   *  exists so a record reaches the SIMBAD TYC namespace, the largest of the
   *  four and the only one covering objects SIMBAD holds no Gaia id for. */
  tyc: string | null;
  gaiaSourceId: string | null; // Gaia DR3 source_id as decimal string; >2^53, never coerce to number
  spectDisplay: string | null; // cleaned-up spectral string for tooltip display
  companionIdx: number;     // assigned later in inferBinaries; -1 = none
  periodDays: number;       // 0 = not a variable known to GCVS
  amplitudeMag: number;     // 0 if not variable
  varType: number;          // VAR_TYPE_* enum from classifyGcvsVarType
  gcvsName: string | null;  // GCVS designation attached by applyVariability (R CrB, VY CMa, V0645 Cen); null when not cross-matched
  /** Build-time-only diagnostics: the parallax cascade's own inversion, before
   *  any override layer fires, and the tier that supplied it. The post-build
   *  distance-regression check measures override drift against them; neither
   *  is written to the binary. Null on Sol (distance zero by construction) and
   *  on records minted rather than walked. */
  plxDistPc: number | null;
  plxVia: DistVia | null;
  /** Which parallax tier (or override layer) this record's distance came from.
   *  Build-time only, like `vVia`, and `null` on the same terms: a promoted
   *  companion with no anchor to inherit a tier from was placed by no cascade.
   *  The optical-double suppression reads it to ask whether a separation is
   *  trustworthy. */
  distVia: DistVia | null;
  /** Which cascade tier supplied the V this record's absmag was derived from,
   *  `null` on records minted rather than read (promoted companions). Read by
   *  companion promotion's flux conservation, which may only subtract a
   *  companion's light from a magnitude that blends the system —
   *  `vTierIsSystemBlend` in ../photometry/v-magnitude-pure.ts. */
  vVia: VVia | null;
  /** Build-time-only synthetic identifier. See
   *  ../companions/README.md#companion-promotion-from-databinariesmultiplestsv
   *  `data/binaries/multiples.tsv`. */
  syntheticId: string | null;
  /** Build-time-only lineage origin key
   *  (../lineage/README.md#identity--the-origin-source-row). */
  originKey: string;
}

/** Every reference table a readStars walk consumes, as one bundle.
 *
 *  `loadReadStarsInputs` assembles the production set and satisfies this whole
 *  interface, so no caller can drop a table by miscounting arguments — which a
 *  positional list did let the inherited-spine generator do, running the walk
 *  with the V cascade's bright tier absent. A test supplies the subset its case
 *  needs and the rest degrade to empty. */
export interface ReadStarsOptions {
  conAssignment: ConstellationAssignment;
  bailerJones?: BailerJonesIndex;
  simbadSpectral?: SimbadSpectralIndex;
  /** Bibcoded SIMBAD values over the per-field value cohort (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) — the rv cascade's bottom
   *  tier. Absent leaves its rows on a zero radial term. */
  simbadValues?: SimbadValueIndex;
  apsisMap?: Map<string, ApsisRow>;
  /** Gaia synthetic Johnson B−V per source_id — the ci cascade's tier below
   *  the Table-5.9 relation. */
  gspcMap?: Map<string, GspcColour>;
  directions?: DirectionSources;
  /** Printed Johnson V per HIP — the V cascade's bright tier. Absent leaves
   *  every saturated row on the tier below, which shows up as vVia drift
   *  against the pinned count snapshot. */
  hipVMag?: Map<number, number>;
  /** Printed Johnson B−V per HIP — the ci cascade's printed tier, and the
   *  only measured colour reaching rows with no Gaia source at all. */
  hipBv?: Map<number, number>;
  /** Printed Gliese 1991 (/data/papers/index.md#gliese1991) V/70A
   *  values keyed on the record's own `gl` — the V cascade's tier below
   *  Tycho-2, and the only one reaching the GJ-only cohort. Absent parks those rows. */
  gliese?: GlieseIndex;
  /** Anchor-grade parallaxes of each record's own bound siblings — the
   *  cascade's tier below SIMBAD. Absent parks the rows it would have
   *  rescued. */
  pairMemberParallax?: PairMemberParallaxIndex;
  dustGrid?: DustGrid | null;
}

export function readStars(
  manifest: Iterable<ManifestRecord>,
  {
    conAssignment,
    bailerJones,
    simbadSpectral = emptySimbadSpectralIndex(),
    simbadValues = emptySimbadValueIndex(),
    apsisMap = new Map(),
    gspcMap = new Map(),
    directions = {
      gaiaAstrometry: new Map(),
      hip2: new Map(),
      nss: new Map(),
      tycho2: new Map(),
      cns5: new Map(),
    },
    hipVMag = new Map(),
    hipBv = new Map(),
    gliese = emptyGlieseIndex(),
    pairMemberParallax = emptyPairMemberParallaxIndex(),
    dustGrid = null,
  }: ReadStarsOptions,
  /** Handed each manifest row's Placement, in walk order: what placement
   *  lineage serialises. The walk keeps none of them. */
  onPlacement: (placement: Placement) => void,
): {
  stars: Star[];
  stats: {
    total: number;
    /** Rows carrying a source_id whose parallax cascade resolved
     *  `gaia_dr3_inversion` — the tier B-J publishes a posterior over. */
    bjEligible: number;
    bjOverridden: number;          // bjEligible rows that hit a B-J entry
    /** Eligible rows the committed B-J table holds no row for. **Pinned at
     *  zero**: an eligible row has its own DR3 parallax, so B-J publishes a
     *  posterior for it and an absence is this pull's request set having
     *  drifted from the manifest's binding column — never the publication.
     *  Such a row silently keeps the naive 1/π inversion, which is exactly
     *  what the posterior exists to moderate. `bjOverridden` cannot catch it:
     *  when the column gains sources the pull was never asked for, that
     *  numerator stops growing, and "stopped growing" reads as no change. */
    bjEligibleNotPulled: number;
    /** The record-parity dropped list (/docs/catalog-driver.md#61-record-parity) — enumerated, because these rows leave the
     *  catalogue and nothing else records that they existed. */
    parked: ParkedRecord[];
    /** The same rows counted per reason. The cascade partitions below run over
     *  RECORDS, so a parked row is in none of them — this is the one place a
     *  park is a number rather than a ledger line. */
    parkedVia: Record<ParkedReason, number>;
    /** Rows whose SHIPPED distance inverts a parallax with worse than 20%
     *  fractional error, so the result is biased. They ship — no second source
     *  reaches them — and this count is how they stay visible for a Gaia DR4
     *  revisit. Bailer-Jones 2021
     *  (/data/papers/index.md#bailerjones2021) rows are excluded: there the
     *  posterior, not the inversion, handles the low-S/N case. */
    distLowPrecisionParallax: number;
    distVia: Record<DistVia, number>;
    lmcCandidates: number;         // rows inside the LMC sky cone (any PM)
    lmcOverridden: number;         // lmcCandidates passing the PM gate (snapped to LMC)
    /** PM-gate passes whose own parallax rules the LMC out, by the tier kept. */
    lmcParallaxRefusedByDistVia: Record<DistVia, number>;
    /** lmcOverridden split by the tier the snap displaced — which populations
     *  the override actually moves. */
    lmcOverriddenByDistVia: Record<DistVia, number>;
    directionVia: Record<DirectionVia, number>; // per-tier direction-cascade routing
    vVia: Record<VVia, number>;    // per-tier V-magnitude cascade routing
    // tycho2-tier rows outside BT−VT ∈ [−0.25, 2.0], wider than ESA 1997
    // (/data/papers/index.md#esa1997) SP-1200's published −0.2 … 1.8
    vTycho2OutsideBtVtRange: number;
    directionTycho2FromIcrs: number;    // tycho2-tier rows placed at the J2000 cell, no mean solution
    directionTycho2Photocentre: number; // tycho2-tier rows whose mean solution is a double's photocentre
    velocityVia: Record<VelocityVia, number>;   // per-tier space-motion PM-source routing
    pmRescueOutcome: Record<PmRescueOutcome, number>;   // rescue-cascade routing over the rows the direction tier left without a PM
    velocityClamped: number;       // rows whose artifact velocity exceeded the sanity ceiling → zeroed
    velocityClampedSample: string[]; // per-clamped-star "id: speed @ dist" for build-log review
    velocityAboveEscape: number;   // kept rows above the Galactic escape velocity (tracked ratchet)
    velocityAboveEscapeSample: string[]; // capped sample of above-escape stars for build-log review
    rvVia: Record<RvVia, number>;  // per-tier radial-velocity cascade routing
    rvSimbadGaiaBibcode: number;   // simbad-tier rows citing a Gaia catalogue release
    rvGaiaBibcodeSkipped: number;  // 2p rows whose Gaia-bibcoded SIMBAD value the skip rule rejected
    rvRadialRejected: number;      // rows whose radial term alone exceeded the sanity ceiling
    rvRadialRejectedSample: string[]; // per-rejected-star "id: rv @ dist" for build-log review
    rvGaiaErrorBand: Record<RvErrorBand, number>; // gaia_dr3-tier rows by stated rv uncertainty
    rvGaiaErrorMaxKmS: number;     // largest stated rv uncertainty on a gaia_dr3-tier row
    rvApplied: number;             // rows whose velocity carries a non-zero radial velocity
    spectralVia: Record<SpectralVia, number>; // per-tier spectral resolver routing; none renders classIdx=8/lumClass=255
    spectralSimbadKey: Record<SimbadNamespace, number>; // which namespace found a SIMBAD-tier row
    ciVia: Record<CiVia, number>;  // per-tier B−V cascade routing
    ciGspcValidatedRange: number;  // gspc-tier rows the archive calls in-range
  };
} {
  const rows = manifest;

  const stars: Star[] = [];
  let total = 0;
  const parked: ParkedRecord[] = [];
  let bjEligible = 0;
  let distLowPrecisionParallax = 0;
  let bjOverridden = 0;
  let bjEligibleNotPulled = 0;
  let lmcCandidates = 0;
  let lmcOverridden = 0;
  const lmcParallaxRefusedByDistVia = emptyTallyPartition(DIST_VIA_VALUES);
  const lmcOverriddenByDistVia = emptyTallyPartition(DIST_VIA_VALUES);
  const distViaCounts = emptyTallyPartition(DIST_VIA_VALUES);
  const directionVia = emptyTallyPartition(DIRECTION_VIA_VALUES);
  const vVia = emptyTallyPartition(V_VIA_VALUES);
  const velocityVia = emptyTallyPartition(VELOCITY_VIA_VALUES);
  const pmRescueOutcomes = emptyTallyPartition(PM_RESCUE_OUTCOMES);
  const rvVia = emptyTallyPartition(RV_VIA_VALUES);
  const rvGaiaErrorBand = emptyTallyPartition(RV_ERROR_BANDS);
  let rvGaiaErrorMaxKmS = 0;
  let rvSimbadGaiaBibcode = 0;
  let rvGaiaBibcodeSkipped = 0;
  let rvRadialRejected = 0;
  const rvRadialRejectedSample: string[] = [];
  const ciVia = emptyTallyPartition(CI_VIA_VALUES);
  const spectralSimbadKey = emptyTallyPartition(SIMBAD_NAMESPACE_VALUES);
  let ciGspcValidatedRange = 0;
  let vTycho2OutsideBtVtRange = 0;
  let directionTycho2FromIcrs = 0;
  let directionTycho2Photocentre = 0;
  let rvApplied = 0;
  let velocityClamped = 0;
  const velocityClampedSample: string[] = [];
  let velocityAboveEscape = 0;
  const velocityAboveEscapeSample: string[] = [];
  const spectralVia = emptyTallyPartition(SPECTRAL_VIA_VALUES);

  const printedVLookup = printedVLookups(hipVMag, directions.tycho2, gliese);
  // Every exit returns its row's Placement, so the compiler refuses one that
  // would drop a record from lineage.
  const walk = (row: ManifestRecord): { placement: Placement; star: Star | null } => {
    const { hip, gaiaSourceId, isSol } = row;
    // Read off the manifest column, never re-derived: the binding is the one
    // the manifest justified (/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries), and re-deciding
    // it here would re-run a cross-walk against reference tables that have
    // moved since.
    const gaiaRow = gaiaSourceId !== null
      ? directions.gaiaAstrometry.get(gaiaSourceId) ?? null
      : null;

    // Radial velocity through Gaia DR3 → bibcoded SIMBAD, feeding the
    // space-motion velocity's radial term.
    // See ../distance/radial-velocity/README.md.
    const simbadKeys: SimbadRecordKeys = {
      sourceId: gaiaSourceId,
      hip,
      tyc: row.tyc,
      gl: row.gl,
    };
    const simbadRow = lookupSimbadValues(simbadValues, simbadKeys);
    const rvRes = resolveRadialVelocity({ gaia: gaiaRow, simbad: simbadRow?.rv ?? null });
    const resolvedRvKmS = rvRes.via === 'none' ? null : rvRes.value.kmS;
    // A radial term past the sanity ceiling on its own is rejected here rather
    // than left to the whole-vector clamp below, which would drop the row's
    // measured proper motion with it.
    const rvRejected = radialTermExceedsCeiling(resolvedRvKmS);
    const rvKmS = rvRejected ? null : resolvedRvKmS;
    rvVia[rvRes.via]++;
    if (rvRes.via === 'simbad' && isGaiaCatalogueBibcode(rvRes.value.bibcode)) {
      rvSimbadGaiaBibcode++;
    }
    if (rvRes.refusals.some((r) => r.tier === 'simbad')) rvGaiaBibcodeSkipped++;
    if (rvRes.via === 'gaia_dr3' && gaiaRow !== null) {
      const rvErr = gaiaRow.radialVelocityErrorKmS;
      rvGaiaErrorBand[rvErrorBand(rvErr)]++;
      if (rvErr !== null && rvErr > rvGaiaErrorMaxKmS) rvGaiaErrorMaxKmS = rvErr;
    }

    const { proper } = row;
    const tycho2Row = simbadKeys.tyc !== null
      ? directions.tycho2.get(simbadKeys.tyc) ?? null
      : null;
    const glieseRow = lookupGliese(gliese, simbadKeys.gl);
    const key = row.originKey;
    const ids: ParkedIdentifiers = { tyc: simbadKeys.tyc, hip, hd: row.hd, gl: simbadKeys.gl, gaiaSourceId };

    // Every distance inverts a parallax this build pulled itself. See
    // ../distance/parallax/README.md.
    const plxRes = resolveParallax(
      {
        gaia: gaiaRow,
        hip2: hip !== null ? directions.hip2.get(hip) ?? null : null,
        cns5: lookupCns5Astrometry(directions.cns5, simbadKeys.gl)?.parallax ?? null,
        gliese: glieseRow,
        simbad: simbadRow?.parallax ?? null,
        pairMember: lookupPairMemberParallax(
          pairMemberParallax, gaiaSourceId, hip,
        ),
      },
      isSol,
    );
    // Not a `dropped` gate: a park is a deliberate record-parity ledger entry (/docs/catalog-driver.md#61-record-parity).
    if (plxRes.via === 'none') {
      return { placement: { kind: 'parked-parallax', key, ids, parallax: plxRes }, star: null };
    }

    // V through the Riello 2021 (/data/papers/index.md#riello2021)
    // transform → printed HIP V → Tycho-2's reduced VT →
    // Gliese's printed Vmag → curated. See ../photometry/README.md. A row no
    // tier lights parks like one no tier places: a record needs both.
    const printed = printedV({
      printed_hip: hip === null ? [] : [hip],
      tycho2: simbadKeys.tyc === null ? [] : [simbadKeys.tyc],
      gliese: simbadKeys.gl === null ? [] : [simbadKeys.gl],
    }, printedVLookup);
    const vRes = resolveVMagnitude({
      photometry: gaiaRow,
      printed,
      curatedV: isSol ? SOL_APPARENT_V_MAGNITUDE : null,
    });
    if (vRes.via === 'none') {
      return { placement: { kind: 'parked-no-v', key, ids, parallax: plxRes }, star: null };
    }

    // Astrometric solution through the Gaia 5p → HIP2 → Tycho-2 → CNS5 →
    // SIMBAD cascade. It is advanced to the scene epoch below, once the motion
    // the row carries is known; position is that direction × distance, both
    // float64 until the float32 pack at write time.
    const direction = resolveDirection(
      { ...simbadKeys, simbad: simbadRow?.astrometry ?? null, isSol },
      directions,
    );
    // A record-parity park (/docs/catalog-driver.md#61-record-parity), not a drop: no tier states where this row is, so its
    // distance has nothing to multiply. Mostly HIP-only additions a bound
    // sibling placed and printed HIP photometry lit, which no positional tier
    // reaches — the SIMBAD values cohort is still keyed on the spine and holds
    // no row for them.
    if (direction.via === 'none') {
      return { placement: { kind: 'parked-no-position', key, ids, parallax: plxRes, direction }, star: null };
    }
    const dirRes = direction.value;

    // The direction tier supplies the PM wherever its own solution carries
    // one. Where it does not — the 2p Gaia cohort, Tycho-2's rows with no mean
    // solution — the tangential term re-keys on the record's own designations
    // rather than shipping static. See ../distance/README.md#the-proper-motion-rescue-cascade.
    const pmRescue = !isSol && dirRes.velVia === 'zero'
      ? resolvePmRescue({
          tycho2: tycho2Row,
          cns5: lookupCns5Astrometry(directions.cns5, simbadKeys.gl)?.pm ?? null,
          simbad: simbadRow?.astrometry?.pm ?? null,
          gaia: gaiaRow,
        })
      : null;
    const velVia = pmRescue === null
      ? dirRes.velVia
      : VELOCITY_VIA_BY_PM_RESCUE[pmRescue.via];
    const { pmRaMasyr, pmDecMasyr } = pmRescue === null
      ? { pmRaMasyr: dirRes.srcPmraMasyr, pmDecMasyr: dirRes.srcPmdecMasyr }
      : pmRescue.via === 'none' ? { pmRaMasyr: null, pmDecMasyr: null } : pmRescue.value;

    // Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021)
    // supersedes the raw inversion wherever the parallax the
    // cascade settled on is Gaia's own — its Bayesian posterior treats exactly
    // that measurement, and a non-Gaia parallax must not be regressed onto
    // B-J's Galactic-density prior tail (~10–40 kpc). A null parallax here is
    // the curated exit (Sol, distance zero by construction); `none` returned
    // above.
    const measuredPlx = plxRes.via === 'curated' ? null : plxRes.value;
    const plxDistPc = measuredPlx === null ? null : 1000 / measuredPlx.mas;
    let dist = plxDistPc ?? 0;
    let distVia: DistVia = plxRes.via;
    const bjEligibleRow = isBailerJonesEligible(gaiaSourceId, plxRes.via);
    if (bjEligibleRow) bjEligible++;
    let bjStep: BailerJonesStep = { kind: 'not-applied' };
    if (bjEligibleRow && bailerJones !== undefined) {
      const ovr = applyBailerJonesOverride(gaiaSourceId, bailerJones);
      if (ovr !== null) {
        dist = ovr.distPc;
        distVia = 'bailer_jones';
        bjOverridden++;
        bjStep = { kind: 'override', ref: ovr.ref };
      } else {
        bjEligibleNotPulled++;
        bjStep = { kind: 'absent' };
      }
    }

    // Runs AFTER B-J so the LMC snap overrides B-J's mis-anchored value on the
    // same rows.
    const raHours = dirRes.srcRaDeg / 15;
    let lmcStep: LmcStep = 'not_member';
    if (isInLmcCone(raHours, dirRes.srcDecDeg)) {
      lmcCandidates++;
      const lmc = applyLmcKinematicOverride(
        raHours, dirRes.srcDecDeg, pmRaMasyr, pmDecMasyr, measuredPlx,
      );
      lmcStep = lmc.kind;
      if (lmc.kind === 'snap') {
        lmcOverriddenByDistVia[distVia]++;
        dist = lmc.distPc;
        distVia = 'lmc_kinematic';
        lmcOverridden++;
      } else if (lmc.kind === 'parallax_rules_out') {
        lmcParallaxRefusedByDistVia[distVia]++;
      }
    }

    if (dist > MAX_DIST_PC) {
      throw new Error(
        `readStars: ${row.originKey} settles at ${dist.toFixed(0)} pc via ${distVia}, past ` +
        `MAX_DIST_PC (${MAX_DIST_PC}) — a reference table disagrees with the tiers above it ` +
        '(../distance/refinement/README.md#layer-3--max_dist_pc-bounded-scope-cutoff).',
      );
    }

    // Tallies run once the row is known to ship, so every partition below
    // sums to the record count.
    distViaCounts[distVia]++;
    // Counted against the SHIPPED tier, not the resolved parallax: where
    // Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021)
    // supersedes the inversion its posterior is what handles a
    // low-S/N parallax, so flagging those rows would report a bias the record
    // does not carry. The LMC snap replaces the distance outright.
    if (measuredPlx !== null && isLowPrecisionParallax(measuredPlx) && distVia === plxRes.via) {
      distLowPrecisionParallax++;
    }
    directionVia[direction.via]++;
    if (direction.via === 'tycho2' && tycho2Row !== null) {
      if (tycho2Row.fromIcrs) directionTycho2FromIcrs++;
      if (tycho2Row.isPhotocentre) directionTycho2Photocentre++;
    }
    if (pmRescue !== null) pmRescueOutcomes[pmRescueOutcome(pmRescue)]++;
    vVia[vRes.via]++;
    if (vRes.via === 'tycho2' && printed?.vVia === 'tycho2' && printed.outsideRange) {
      vTycho2OutsideBtVtRange++;
    }

    // absmag derives from that V and the distance the whole override stack
    // settled on — except for Sol, which sits at distance zero where the
    // modulus is undefined and takes SOL_ABSOLUTE_V_MAGNITUDE instead.
    let absmag = isSol
      ? SOL_ABSOLUTE_V_MAGNITUDE
      : apparentToAbsoluteMagnitude(vRes.value, dist);

    // Must follow the PM rescue: the position advances on the motion the row
    // ends up carrying, which is the rescue's wherever the tier states none.
    const dir = directionOnPm(dirRes, pmRaMasyr, pmDecMasyr);
    const x = dir.x * dist;
    const y = dir.y * dist;
    const z = dir.z * dist;

    // Space-motion velocity from the direction tier's own position + the PM
    // resolved above + the final stack distance + the rv cascade's radial
    // term. Sol carries no PM row and sits at the origin — force it to exactly
    // zero so the advance pass leaves the world origin fixed.
    let vel = isSol
      ? { x: 0, y: 0, z: 0 }
      : velocityPcPerYr(
          dirRes.srcRaDeg, dirRes.srcDecDeg, pmRaMasyr, pmDecMasyr, dist, rvKmS,
        );
    // Physical sanity: a space velocity past the ceiling is a PM×distance
    // artifact (spurious PM on a faint distant star). Drop to zero — kept
    // at J2016.0, the same fall-through as no-PM rows — so it doesn't
    // streak under the epoch-advance. Sol is already zero.
    let velClamped = false;
    const speedPcYr = Math.hypot(vel.x, vel.y, vel.z);
    const idLabel = (): string => proper
      ?? (hip !== null ? `HIP ${hip}` : gaiaSourceId ? `Gaia ${gaiaSourceId}` : '(anon)');
    if (rvRejected) {
      rvRadialRejected++;
      rvRadialRejectedSample.push(
        `${idLabel()}: ${resolvedRvKmS?.toFixed(1)} km/s @ ${dist.toFixed(1)} pc`,
      );
    }
    if (speedPcYr > VELOCITY_SANITY_CEILING_PC_YR) {
      velocityClampedSample.push(
        `${idLabel()}: ${(speedPcYr / KM_S_TO_PC_YR).toFixed(0)} km/s @ ${dist.toFixed(0)} pc`,
      );
      vel = { x: 0, y: 0, z: 0 };
      velClamped = true;
    } else if (!isSol && speedPcYr > GALACTIC_ESCAPE_VELOCITY_PC_YR) {
      // Kept (a proven escaper must survive) but tracked — this band is
      // almost all PM×distance / bad-RV artifacts.
      velocityAboveEscape++;
      if (velocityAboveEscapeSample.length < 25) {
        velocityAboveEscapeSample.push(
          `${idLabel()}: ${(speedPcYr / KM_S_TO_PC_YR).toFixed(0)} km/s @ ${dist.toFixed(0)} pc`,
        );
      }
    }
    velocityVia[isSol || velClamped ? 'zero' : velVia]++;
    if (velClamped) velocityClamped++;
    if (!isSol && !velClamped && rvKmS !== null && rvKmS !== 0) rvApplied++;

    // Sol carries no HIP, no Gaia source_id, and no SIMBAD row, so every
    // machine tier misses and the unknown-class 5000 K row misizes it
    // (R 1.27 instead of ~1.03) — the one record addressable only by name.
    const spectral: SpectralResolution = isSol
      ? {
          via: 'curated',
          value: { info: classifyFromSimbad('G2V')!, spectDisplay: 'G2V' },
          refusals: [],
        }
      : resolveSpectralInfo(simbadKeys, simbadSpectral, apsisMap);
    const spectInfo = spectral.via === 'none' ? SPECTRAL_UNKNOWN : spectral.value.info;
    spectralVia[spectral.via]++;
    if (spectral.via === 'simbad') spectralSimbadKey[spectral.value.namespace]++;
    const apsisTeff = resolveApsisTeff(
      gaiaSourceId ? apsisMap.get(gaiaSourceId) : null,
    );

    // B−V through the Gaia relation → printed I/239 B−V → synthetic
    // photometry → intrinsic spectral class, else solar. Printed above synthetic
    // inverts /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers — ../photometry/README.md#the-ci-cascade.
    // The baked value only drives colour for no-Apsis stars, which is
    // why the derived tiers gate on apsisTeff.
    const gspc = gaiaSourceId ? gspcMap.get(gaiaSourceId) ?? null : null;
    const ciRes = resolveColourIndex({
      photometry: gaiaRow,
      gspc,
      printedHipBv: printedByHip(hipBv, hip),
      apsisTeff,
      spectralCi: spectralClassColorIsDerivable(spectInfo)
        ? spectralClassCi(spectInfo)
        : null,
    });
    let ci = ciRes.via === 'none' ? SOLAR_BV_FALLBACK : ciRes.value;
    ciVia[ciRes.via]++;
    if (ciRes.via === 'gspc' && gspc?.inValidatedRange) ciGspcValidatedRange++;

    // Build-time de-extinction: absmag and an observed ci are
    // observed-convention (embed the real Sol→star A_V), so subtract
    // the map integral to recover intrinsic values the runtime raymarch
    // re-adds. Runs before physicalRadius so radii size off the
    // de-extincted (brighter) absmag. A spectral-derived or solar-fallback
    // ci is already intrinsic and must not be de-reddened (the same
    // contract companion-promotion's companionCiIsObserved gates on).
    if (dustGrid) {
      const av = avSolToStar(dustGrid, x, y, z);
      absmag -= av;
      if (ciIsObserved(ciRes.via)) ci -= av / R_V;
    }

    const physRadius = physicalRadius(absmag, spectInfo, apsisTeff);

    // Byte 34 is positional: the IAU boundaries partition the whole sphere,
    // so it resolves for any direction, catalogued or not. Sol is the one
    // record with no direction to resolve.
    const conIndex = isSol
      ? NO_CONSTELLATION_INDEX
      : conAssignment.indexAt(x, y, z);

    const { bayer } = row;

    let flags = 0;
    if (proper) flags |= FLAG_HAS_NAME;
    if (isSol) flags |= FLAG_IS_SOL;
    if (bayer) flags |= FLAG_HAS_BAYER;

    const star: Star = {
      x, y, z,
      vx: vel.x, vy: vel.y, vz: vel.z,
      absmag, ci,
      spectClass: spectInfo.classIdx,
      lumClass: spectInfo.lumClass,
      physicalRadius: physRadius,
      conIndex,
      // Left unset here: three later passes fill it, and everything else
      // reads `conIndex`.
      desigConIndex: NO_CONSTELLATION_INDEX,
      flags,
      proper, bayer, hip,
      hd: row.hd,
      hr: row.hr,
      flam: row.flam,
      iauName: null,
      eponym: null,
      bayerSup: null,
      bayerComponent: null,
      gould: null,
      gouldHalf: null,
      aliases: [],
      hdAlt: row.hdAlt,
      hrAlt: row.hrAlt,
      gl: simbadKeys.gl,
      tyc: simbadKeys.tyc,
      gaiaSourceId,
      spectDisplay: spectral.via === 'none' ? null : spectral.value.spectDisplay,
      companionIdx: -1,
      periodDays: 0,
      amplitudeMag: 0,
      varType: 0,
      gcvsName: null,
      plxDistPc,
      plxVia: plxRes.via,
      distVia,
      vVia: vRes.via,
      syntheticId: null,
      originKey: row.originKey,
    };
    return {
      placement: {
        kind: 'placed',
        key,
        parallax: plxRes,
        direction,
        pmRescue,
        bailerJones: bjStep,
        lmc: lmcStep,
        rv: rvRejected && rvRes.via !== 'none' ? { kind: 'rejected', rv: rvRes } : { kind: 'kept', rv: rvRes },
        velocityClamped: velClamped,
      },
      star,
    };
  };

  for (const row of rows) {
    total++;
    const { placement, star } = walk(row);
    onPlacement(placement);
    const park = parkedRecord(placement);
    if (park !== null) parked.push(park);
    if (star !== null) stars.push(star);
  }

  const parkedVia = emptyTallyPartition(PARKED_REASONS);
  for (const p of parked) parkedVia[p.reason]++;

  return {
    stars,
    stats: {
      total,
      bjEligible,
      bjOverridden,
      bjEligibleNotPulled,
      parked,
      parkedVia,
      distLowPrecisionParallax,
      distVia: distViaCounts,
      lmcCandidates,
      lmcOverridden,
      lmcParallaxRefusedByDistVia,
      lmcOverriddenByDistVia,
      directionVia,
      vVia,
      velocityVia,
      pmRescueOutcome: pmRescueOutcomes,
      velocityClamped,
      velocityClampedSample,
      velocityAboveEscape,
      velocityAboveEscapeSample,
      rvVia,
      rvSimbadGaiaBibcode,
      rvGaiaBibcodeSkipped,
      rvRadialRejected,
      rvRadialRejectedSample,
      rvGaiaErrorBand,
      rvGaiaErrorMaxKmS,
      rvApplied,
      spectralVia,
      spectralSimbadKey,
      ciVia,
      ciGspcValidatedRange,
      vTycho2OutsideBtVtRange,
      directionTycho2FromIcrs,
      directionTycho2Photocentre,
    },
  };
}
