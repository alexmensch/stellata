// Membership-manifest reader: resolveRow per row — parallax cascade, its two
// override layers, direction cascade and the rest — folded into the in-memory
// Star records every downstream builder step reads. See scripts/catalog/README.md.

import {
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  NO_CONSTELLATION_INDEX,
  SOLAR_BV_FALLBACK,
  type ApsisRow,
  type DistVia,
} from '../../../src/catalog-format/record/catalog-pure';
import { absoluteMagnitude } from '../../../src/astro-core/perceptual-magnitude';
import type { CitedValue } from '../cascade-result';
import type { SimbadRecordKeys } from '../simbad/simbad-namespace-ladder-pure';
import {
  SPECTRAL_UNKNOWN,
  type SpectralInfo,
} from '../../../src/catalog-format/spectral/spectral-classify';
import {
  type SimbadSpectralIndex,
  type SpectralSources,
  emptySimbadSpectralIndex,
  resolveSpectralInfo,
} from '../spectral/spectral-resolve';
import {
  physicalRadius,
  resolveApsisTeff,
  spectralClassCi,
  spectralClassColorIsDerivable,
} from '../../../src/catalog-format/spectral/physical-radius';
import {
  resolveDirection,
  directionOnPm,
  type DirectionSources,
} from '../distance/direction-cascade';
import {
  velocityPcPerYr,
  KM_S_TO_PC_YR,
  VELOCITY_SANITY_CEILING_PC_YR,
  GALACTIC_ESCAPE_VELOCITY_PC_YR,
  type VelocityVia,
} from '../distance/velocity';
import { lookupCns5Astrometry } from '../classic-ids/classic-ids-parse';
import { resolveParallax } from '../distance/parallax/parallax-cascade';
import type { ParkedIdentifiers } from '../distance/parallax/parked-ledger-pure';
import {
  shippedDistVia,
  type BailerJonesStep,
  type LmcStep,
  type ParkedPlacement,
  type Placement,
  type PlacedPlacement,
} from '../distance/placement-lineage-pure';
import {
  emptyPairMemberParallaxIndex,
  lookupPairMemberParallax,
  type PairMemberParallaxIndex,
} from '../distance/parallax/pair-member-parallax';
import { resolvePmRescue, VELOCITY_VIA_BY_PM_RESCUE } from '../distance/pm-rescue/pm-rescue';
import {
  radialTermExceedsCeiling,
  resolveRadialVelocity,
  rvErrorBand,
  type RadialVelocityResolution,
  type RvErrorBand,
} from '../distance/radial-velocity/radial-velocity';
import { avSolToStar, type DustGrid } from '../distance/dust/dust-deextinction-pure';
import { GAIA_APSIS } from '../record/gaia-apsis-source';
import type { BrightnessColour, DustStep, ShippedBrightness } from '../photometry/brightness-colour-lineage-pure';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { R_V } from '../../../src/astro-core/extinction/dust-raymarch-pure';
import {
  emptySimbadValueIndex,
  lookupSimbadValues,
  type SimbadValueIndex,
} from '../simbad/simbad-values-parse';
import {
  printedV,
  printedVLookups,
  resolveVMagnitude,
  type PrintedVLookups,
  type VVia,
} from '../photometry/v-magnitude-pure';
import {
  emptyGlieseIndex,
  lookupGliese,
  type GlieseIndex,
} from '../gliese-parse-pure';
import { ciIsObserved, resolveColourIndex } from '../photometry/colour-index-pure';
import type { GspcColour } from '../photometry/gspc-parse';
import { printedByHip, type PrintedHipValue } from '../photometry/hip-photometry-parse-pure';
import type { ManifestRecord } from '../membership/membership-manifest-tsv';
import type { CuratedRecords } from '../record/curated-records';
import { type ConstellationAssignment } from './constellations/constellations';
import { NO_DESIGNATION_CON, type DesignationCon } from '../classic-ids/designation-constellation-pure';
import {
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  isBailerJonesEligible,
  isInLmcCone,
  type BailerJonesIndex,
} from '../distance/refinement/distance-overrides-pure';
import { walkStatsFold, type WalkStats } from './walk-stats-pure';

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
  /** Build-time only: the record write packs it into its two class bytes. */
  spectral: SpectralInfo;
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
  desigCon: DesignationCon;
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


/** One manifest row's decisions: its placement, and its brightness and colour
 *  wherever the walk reached V. */
export interface WalkedRow {
  readonly placement: Placement;
  readonly brightness: BrightnessColour | null;
}

/** The radial-velocity cascade's answer, resolved on every row before any park. */
export interface RvRouting {
  readonly resolution: RadialVelocityResolution;
  /** Null exactly when the Gaia DR3 tier did not answer. */
  readonly gaiaError: { readonly band: RvErrorBand; readonly kmS: number | null } | null;
}

export type VelocityVerdict =
  | { readonly kind: 'kept' }
  | { readonly kind: 'clamped'; readonly sample: string }
  | { readonly kind: 'above-escape'; readonly sample: string };

/** What a shipped row decided that neither its placement nor its brightness
 *  carries: the per-row facts its counts fold from. */
export interface ShippedFacts {
  readonly bailerJonesEligible: boolean;
  /** Inside the LMC sky cone, whatever the PM gate made of the row. */
  readonly inLmcCone: boolean;
  readonly tycho2Direction: { readonly fromIcrs: boolean; readonly isPhotocentre: boolean } | null;
  readonly vTycho2OutsideBtVtRange: boolean;
  /** `zero` wherever the origin or the sanity clamp zeroed the vector. */
  readonly velocityVia: VelocityVia;
  readonly velocity: VelocityVerdict;
  readonly rvRejectedSample: string | null;
  readonly rvApplied: boolean;
  readonly ciGspcValidatedRange: boolean;
}

/** One manifest row resolved: parked, or a record with the provenance of each
 *  field. No row is dropped — a row past MAX_DIST_PC throws. */
export type RowOutcome =
  | {
    readonly kind: 'parked';
    readonly placement: ParkedPlacement;
    readonly brightness: BrightnessColour | null;
    readonly rv: RvRouting;
  }
  | {
    readonly kind: 'shipped';
    readonly placement: PlacedPlacement;
    readonly brightness: ShippedBrightness;
    readonly rv: RvRouting;
    readonly star: Star;
    readonly facts: ShippedFacts;
  };

/** Every reference table a readStars walk consumes, as one bundle.
 *
 *  `loadReadStarsInputs` assembles the production set and satisfies this whole
 *  interface, so no caller can drop a table by miscounting arguments — which a
 *  positional list did let the inherited-spine generator do, running the walk
 *  with the V cascade's bright tier absent. A test supplies the subset its case
 *  needs and the rest degrade to empty. */
export interface ReadStarsOptions {
  conAssignment: ConstellationAssignment;
  /** `CURATED_RECORDS` — every cascade's curated tier. Absent parks Sol. */
  curatedRecords?: CuratedRecords;
  bailerJones?: BailerJonesIndex;
  simbadSpectral?: SimbadSpectralIndex;
  /** `SPTYPE_OVERRIDES` — the spectral resolver's curated tier. */
  sptypeOverrides?: SpectralSources['sptypeOverrides'];
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
  hipVMag?: Map<number, PrintedHipValue>;
  /** Printed Johnson B−V per HIP — the ci cascade's printed tier, and the
   *  only measured colour reaching rows with no Gaia source at all. */
  hipBv?: Map<number, PrintedHipValue>;
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

/** ReadStarsOptions with every absent table degraded to empty, and the
 *  lookups resolveRow derives from them built once. */
export interface RowSources {
  readonly conAssignment: ConstellationAssignment;
  readonly curatedRecords: CuratedRecords;
  readonly bailerJones: BailerJonesIndex | undefined;
  readonly spectral: SpectralSources;
  readonly simbadValues: SimbadValueIndex;
  readonly apsisMap: ReadonlyMap<string, ApsisRow>;
  readonly gspcMap: ReadonlyMap<string, GspcColour>;
  readonly directions: DirectionSources;
  readonly hipBv: ReadonlyMap<number, PrintedHipValue>;
  readonly gliese: GlieseIndex;
  readonly printedV: PrintedVLookups;
  readonly pairMemberParallax: PairMemberParallaxIndex;
  readonly dustGrid: DustGrid | null;
}

export function rowSources({
  conAssignment,
  curatedRecords = () => null,
  bailerJones,
  simbadSpectral = emptySimbadSpectralIndex(),
  sptypeOverrides = new Map(),
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
}: ReadStarsOptions): RowSources {
  return {
    conAssignment,
    curatedRecords,
    bailerJones,
    spectral: { simbad: simbadSpectral, sptypeOverrides },
    simbadValues,
    apsisMap,
    gspcMap,
    directions,
    hipBv,
    gliese,
    printedV: printedVLookups(hipVMag, directions.tycho2, gliese),
    pairMemberParallax,
    dustGrid,
  };
}

/** See README.md#per-row-pipeline. */
export function readStars(
  manifest: Iterable<ManifestRecord>,
  options: ReadStarsOptions,
  onRow: (row: WalkedRow) => void,
): { stars: Star[]; stats: WalkStats } {
  const sources = rowSources(options);
  const stars: Star[] = [];
  const stats = walkStatsFold();
  for (const row of manifest) {
    const outcome = resolveRow(row, sources);
    onRow(outcome);
    stats.add(outcome);
    if (outcome.kind === 'shipped') stars.push(outcome.star);
  }
  return { stars, stats: stats.result() };
}

/** One manifest row through every cascade. See README.md#per-row-pipeline. */
export function resolveRow(row: ManifestRecord, sources: RowSources): RowOutcome {
  const { directions } = sources;
  const { hip, gaiaSourceId } = row;
  const curated = sources.curatedRecords(row);
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
  const simbadRow = lookupSimbadValues(sources.simbadValues, simbadKeys);
  const rvRes = resolveRadialVelocity({ gaia: gaiaRow, simbad: simbadRow?.rv ?? null });
  const gaiaRvErrorKmS = rvRes.via === 'gaia_dr3' && gaiaRow !== null ? gaiaRow.radialVelocityErrorKmS : undefined;
  const rv: RvRouting = {
    resolution: rvRes,
    gaiaError: gaiaRvErrorKmS === undefined ? null : { band: rvErrorBand(gaiaRvErrorKmS), kmS: gaiaRvErrorKmS },
  };
  const resolvedRvKmS = rvRes.via === 'none' ? null : rvRes.value.kmS;
  // A radial term past the sanity ceiling on its own is rejected here rather
  // than left to the whole-vector clamp below, which would drop the row's
  // measured proper motion with it.
  const rvRejected = radialTermExceedsCeiling(resolvedRvKmS);
  const rvKmS = rvRejected ? null : resolvedRvKmS;

  const { proper } = row;
  const tycho2Row = simbadKeys.tyc !== null
    ? directions.tycho2.get(simbadKeys.tyc) ?? null
    : null;
  const glieseRow = lookupGliese(sources.gliese, simbadKeys.gl);
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
        sources.pairMemberParallax, gaiaSourceId, hip,
      ),
      curated: curated?.placement ?? null,
    },
  );
  // Not a `dropped` gate: a park is a deliberate record-parity ledger entry (/docs/catalog-driver.md#61-record-parity).
  if (plxRes.via === 'none') {
    return { kind: 'parked', placement: { kind: 'parked-parallax', key, ids, parallax: plxRes }, brightness: null, rv };
  }

  // V through the Riello 2021 (/data/papers/index.md#riello2021)
  // transform → printed HIP V → Tycho-2's reduced VT →
  // Gliese's printed Vmag → curated. See ../photometry/README.md. A row no
  // tier lights parks like one no tier places: a record needs both.
  const printed = printedV({
    printed_hip: hip === null ? [] : [hip],
    tycho2: simbadKeys.tyc === null ? [] : [simbadKeys.tyc],
    gliese: simbadKeys.gl === null ? [] : [simbadKeys.gl],
  }, sources.printedV);
  const vRes = resolveVMagnitude({
    photometry: gaiaRow,
    printed,
    curatedV: curated?.vMagnitude ?? null,
  });
  if (vRes.via === 'none') {
    return {
      kind: 'parked',
      placement: { kind: 'parked-no-v', key, ids, parallax: plxRes },
      brightness: { kind: 'v-only', key, v: vRes },
      rv,
    };
  }

  // Astrometric solution through the Gaia 5p → HIP2 → Tycho-2 → CNS5 →
  // SIMBAD cascade. It is advanced to the scene epoch below, once the motion
  // the row carries is known; position is that direction × distance, both
  // float64 until the float32 pack at write time.
  const direction = resolveDirection(
    { ...simbadKeys, simbad: simbadRow?.astrometry ?? null, curated: curated?.direction ?? null },
    directions,
  );
  // A record-parity park (/docs/catalog-driver.md#61-record-parity), not a drop: no tier states where this row is, so its
  // distance has nothing to multiply. Mostly HIP-only additions a bound
  // sibling placed and printed HIP photometry lit, which no positional tier
  // reaches — the SIMBAD values cohort is still keyed on the spine and holds
  // no row for them.
  if (direction.via === 'none') {
    return {
      kind: 'parked',
      placement: { kind: 'parked-no-position', key, ids, parallax: plxRes, direction },
      brightness: { kind: 'v-only', key, v: vRes },
      rv,
    };
  }
  const dirRes = direction.value;

  // The direction tier supplies the PM wherever its own solution carries
  // one. Where it does not — the 2p Gaia cohort, Tycho-2's rows with no mean
  // solution — the tangential term re-keys on the record's own designations
  // rather than shipping static. See ../distance/README.md#the-proper-motion-rescue-cascade.
  const origin = plxRes.via === 'curated' ? plxRes.value : null;
  const pmRescue = origin === null && dirRes.velVia === 'zero'
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
  // the curated exit, at the origin; `none` returned above.
  const measuredPlx = plxRes.via === 'curated' ? null : plxRes.value;
  const plxDistPc = measuredPlx === null ? null : 1000 / measuredPlx.mas;
  let dist = plxDistPc ?? 0;
  const bailerJonesEligible = isBailerJonesEligible(gaiaSourceId, plxRes.via);
  let bjStep: BailerJonesStep = { kind: 'not-applied' };
  if (bailerJonesEligible && sources.bailerJones !== undefined) {
    const ovr = applyBailerJonesOverride(gaiaSourceId, sources.bailerJones);
    if (ovr !== null) {
      dist = ovr.distPc;
      bjStep = { kind: 'override', ref: ovr.ref };
    } else {
      bjStep = { kind: 'absent' };
    }
  }

  // Runs AFTER B-J so the LMC snap overrides B-J's mis-anchored value on the
  // same rows.
  const raHours = dirRes.srcRaDeg / 15;
  let lmcStep: LmcStep = 'not_member';
  const inLmcCone = isInLmcCone(raHours, dirRes.srcDecDeg);
  if (inLmcCone) {
    const lmc = applyLmcKinematicOverride(
      raHours, dirRes.srcDecDeg, pmRaMasyr, pmDecMasyr, measuredPlx,
    );
    lmcStep = lmc.kind;
    if (lmc.kind === 'snap') dist = lmc.distPc;
  }
  const distVia = shippedDistVia({ parallax: plxRes, bailerJones: bjStep, lmc: lmcStep });

  if (dist > MAX_DIST_PC) {
    throw new Error(
      `readStars: ${row.originKey} settles at ${dist.toFixed(0)} pc via ${distVia}, past ` +
      `MAX_DIST_PC (${MAX_DIST_PC}) — a reference table disagrees with the tiers above it ` +
      '(../distance/refinement/README.md#layer-3--max_dist_pc-bounded-scope-cutoff).',
    );
  }

  // absmag derives from that V and the distance the whole override stack
  // settled on.
  let absmag = origin !== null
    ? origin.absoluteVMagnitude
    : absoluteMagnitude(vRes.value, dist);

  // Must follow the PM rescue: the position advances on the motion the row
  // ends up carrying, which is the rescue's wherever the tier states none.
  const dir = directionOnPm(dirRes, pmRaMasyr, pmDecMasyr);
  const x = dir.x * dist;
  const y = dir.y * dist;
  const z = dir.z * dist;

  // Space-motion velocity from the direction tier's own position + the PM
  // resolved above + the final stack distance + the rv cascade's radial
  // term. The origin is forced to exactly zero so the advance pass leaves the
  // world origin fixed.
  let vel = origin !== null
    ? { x: 0, y: 0, z: 0 }
    : velocityPcPerYr(
        dirRes.srcRaDeg, dirRes.srcDecDeg, pmRaMasyr, pmDecMasyr, dist, rvKmS,
      );
  // Physical sanity: a space velocity past the ceiling is a PM×distance
  // artifact (spurious PM on a faint distant star). Drop to zero — kept
  // at J2016.0, the same fall-through as no-PM rows — so it doesn't
  // streak under the epoch-advance. Above the escape velocity a row is kept
  // (a proven escaper must survive) but tracked: that band is almost all
  // PM×distance / bad-RV artifacts.
  const speedPcYr = Math.hypot(vel.x, vel.y, vel.z);
  const idLabel = (): string => proper
    ?? (hip !== null ? `HIP ${hip}` : gaiaSourceId ? `Gaia ${gaiaSourceId}` : '(anon)');
  const speedSample = (): string =>
    `${idLabel()}: ${(speedPcYr / KM_S_TO_PC_YR).toFixed(0)} km/s @ ${dist.toFixed(0)} pc`;
  const velocity: VelocityVerdict = speedPcYr > VELOCITY_SANITY_CEILING_PC_YR
    ? { kind: 'clamped', sample: speedSample() }
    : speedPcYr > GALACTIC_ESCAPE_VELOCITY_PC_YR
      ? { kind: 'above-escape', sample: speedSample() }
      : { kind: 'kept' };
  if (velocity.kind === 'clamped') vel = { x: 0, y: 0, z: 0 };
  const velZeroed = origin !== null || velocity.kind === 'clamped';

  let apsis: CitedValue<ApsisRow> | null = null;
  if (gaiaSourceId) {
    const apsisRow = sources.apsisMap.get(gaiaSourceId);
    if (apsisRow !== undefined) apsis = { value: apsisRow, ref: sourceRowRef(GAIA_APSIS, gaiaSourceId) };
  }
  const spectral = resolveSpectralInfo(
    { ...simbadKeys, curated: curated?.spectral ?? null, apsis }, sources.spectral,
  );
  const spectInfo = spectral.via === 'none' ? SPECTRAL_UNKNOWN : spectral.value.info;
  const apsisTeff = resolveApsisTeff(apsis?.value);
  const citedApsisTeff = apsis === null || apsisTeff === null ? null : { value: apsisTeff, ref: apsis.ref };

  // B−V through the Gaia relation → printed I/239 B−V → synthetic
  // photometry → intrinsic spectral class, else solar. Printed above synthetic
  // inverts /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers — ../photometry/README.md#the-ci-cascade.
  // The baked value only drives colour for no-Apsis stars, which is
  // why the derived tiers gate on apsisTeff.
  const gspc = gaiaSourceId ? sources.gspcMap.get(gaiaSourceId) ?? null : null;
  const ciRes = resolveColourIndex({
    photometry: gaiaRow,
    gspc,
    printedHipBv: printedByHip(sources.hipBv, hip),
    apsisTeff: citedApsisTeff,
    spectralCi: spectralClassColorIsDerivable(spectInfo)
      ? { value: spectralClassCi(spectInfo), evidence: spectral.via === 'none' ? [] : spectral.evidence }
      : null,
  });
  let ci = ciRes.via === 'none' ? SOLAR_BV_FALLBACK : ciRes.value;

  // Build-time de-extinction: absmag and an observed ci are
  // observed-convention (embed the real Sol→star A_V), so subtract
  // the map integral to recover intrinsic values the runtime raymarch
  // re-adds. Runs before physicalRadius so radii size off the
  // de-extincted (brighter) absmag. A spectral-derived or solar-fallback
  // ci is already intrinsic and must not be de-reddened (the same
  // contract companion-promotion's companionCiIsObserved gates on).
  let dust: DustStep | null = null;
  if (sources.dustGrid) {
    const av = avSolToStar(sources.dustGrid, x, y, z);
    const ciDereddened = ciIsObserved(ciRes.via);
    absmag -= av;
    if (ciDereddened) ci -= av / R_V;
    dust = { av, ciDereddened };
  }

  const physRadius = physicalRadius(absmag, spectInfo, apsisTeff);

  // Byte 34 is positional: the IAU boundaries partition the whole sphere,
  // so it resolves for any direction, catalogued or not.
  const conIndex = origin !== null
    ? NO_CONSTELLATION_INDEX
    : sources.conAssignment.indexAt(x, y, z);

  const { bayer } = row;

  let flags = 0;
  if (proper) flags |= FLAG_HAS_NAME;
  if (row.isSol) flags |= FLAG_IS_SOL;
  if (bayer) flags |= FLAG_HAS_BAYER;

  const star: Star = {
    x, y, z,
    vx: vel.x, vy: vel.y, vz: vel.z,
    absmag, ci,
    spectral: spectInfo,
    physicalRadius: physRadius,
    conIndex,
    // Left unset here: three later passes fill it, and everything else
    // reads `conIndex`.
    desigCon: NO_DESIGNATION_CON,
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
    kind: 'shipped',
    placement: {
      kind: 'placed',
      key,
      parallax: plxRes,
      direction,
      pmRescue,
      bailerJones: bjStep,
      lmc: lmcStep,
      rv: rvRejected && rvRes.via !== 'none' ? { kind: 'rejected', rv: rvRes } : { kind: 'kept', rv: rvRes },
      velocityClamped: velocity.kind === 'clamped',
    },
    brightness: { kind: 'shipped', key, v: vRes, spectral, ci: ciRes, dust },
    rv,
    star,
    facts: {
      bailerJonesEligible,
      inLmcCone,
      tycho2Direction: direction.via === 'tycho2' && tycho2Row !== null
        ? { fromIcrs: tycho2Row.fromIcrs, isPhotocentre: tycho2Row.isPhotocentre }
        : null,
      vTycho2OutsideBtVtRange: vRes.via === 'tycho2' && printed?.vVia === 'tycho2' && printed.outsideRange,
      velocityVia: velZeroed ? 'zero' : velVia,
      velocity,
      rvRejectedSample: rvRejected
        ? `${idLabel()}: ${resolvedRvKmS?.toFixed(1)} km/s @ ${dist.toFixed(1)} pc`
        : null,
      rvApplied: !velZeroed && rvKmS !== null && rvKmS !== 0,
      ciGspcValidatedRange: ciRes.via === 'gspc' && gspc?.inValidatedRange === true,
    },
  };
}
