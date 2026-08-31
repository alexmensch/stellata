// Inherited-spine reader: per-row distance stack (Bailer-Jones / HIP2
// parallax / LMC overrides) × direction cascade → in-memory Star
// records for every downstream builder step. See scripts/catalog/README.md.
import { readFileSync } from 'node:fs';

import {
  isBailerJonesEligible,
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  apparentToAbsoluteMagnitude,
  isInLmcCone,
  emptyDistSrcPartition,
  tallyDistSrc,
  DIST_SRC_HIP,
  SOL_ABSOLUTE_V_MAGNITUDE,
  SOL_APPARENT_V_MAGNITUDE,
  SOL_PROPER_NAME,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  NO_CONSTELLATION_INDEX,
  SIMBAD_NAMESPACE_VALUES,
  type ApsisRow,
  type DistSrcPartition,
  type SimbadNamespace,
  type SimbadRecordKeys,
} from '../catalog-pure';
import {
  classifyFromSimbad,
  resolveSpectDisplay,
} from '../spectral/spectral-classify';
import {
  type SimbadSpectralIndex,
  emptySimbadSpectralIndex,
  resolveSpectralInfo,
} from '../spectral/spectral-resolve';
import {
  physicalRadius,
  resolveApsisTeff,
  spectralClassCi,
  spectralClassColorIsDerivable,
} from '../spectral/physical-radius';
import {
  resolveDirection,
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
import { gaiaHas5pSolution } from '../distance/gaia-distrust';
import {
  resolvePmRescue,
  PM_RESCUE_VIA_VALUES,
  VELOCITY_VIA_BY_PM_RESCUE,
  type PmRescueVia,
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
import { R_V, avSolToStar, type DustGrid } from '../distance/dust-deextinction-pure';
import {
  emptySimbadValueIndex,
  lookupSimbadValues,
  type SimbadValueIndex,
} from '../simbad-values-parse';
import {
  resolveVMagnitude,
  tycho2VMagnitude,
  V_VIA_VALUES,
  type VVia,
} from '../photometry/v-magnitude-pure';
import {
  emptyGlieseIndex,
  lookupGliese,
  type GlieseIndex,
} from '../gliese-parse';
import {
  resolveColourIndex,
  CI_VIA_VALUES,
  type CiVia,
} from '../photometry/colour-index-pure';
import type { GspcColour } from '../photometry/gspc-parse';
import { printedByHip } from '../photometry/hip-photometry-parse';
import { emptyTallyPartition } from '../../util/tally';
import { iterSpineTsv } from '../spine/inherited-spine-pure';
import { type ConstellationAssignment } from './constellations';

// Drop stars farther than this from Sol. AT-HYG carries a handful of
// extragalactic stragglers (LMC supergiants pre-override, plus a few
// distant outliers) that the renderer's float32 origin can't keep
// stable; the LMC override snaps those back inside the cutoff before
// it fires. Every kinematic-override target distance must stay below
// this cut or its population is silently dropped here —
// catalog-pure.test.ts pins LMC_DISTANCE_PC < MAX_DIST_PC.
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
   *  designations fall back to `conIndex`.
   *
   *  Only a GCVS name supplies it today. Bayer and Flamsteed designations no
   *  longer reach it — their source was AT-HYG's editorial `con` cell, which
   *  left with the driver — so ρ Aql, the star the field exists for, takes the
   *  fallback and searches under Delphinus. Known regression, not the intended
   *  rule: ./README.md § Positional constellation membership has the standing
   *  behaviour and who restores it. */
  desigConIndex: number;
  flags: number;
  proper: string | null;
  bayer: string | null;
  hip: number | null;
  hd: number | null;
  hr: number | null;
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
  // Build-time-only diagnostic fields. The spine's printed AT-HYG cells,
  // captured before any override fires; consumed by the post-build
  // distance-regression check and NOT written to the binary.
  athygDist: number | null;     // printed `dist`, pre-override
  athygDistSrc: string | null;  // printed `dist_src`
  /** Which cascade tier supplied the V this record's absmag was derived from,
   *  `null` on records minted rather than read (promoted companions). Read by
   *  companion promotion's flux conservation, which may only subtract a
   *  companion's light from a magnitude that blends the system —
   *  `vTierIsSystemBlend` in ../photometry/v-magnitude-pure.ts. */
  vVia: VVia | null;
  /** Build-time-only synthetic identifier. See
   *  ../companions/README.md § Companion promotion from
   *  `data/binaries/multiples.tsv`. */
  syntheticId: string | null;
}

export function parseFloatOrNull(s: string | undefined | null): number | null {
  if (s === '' || s === undefined || s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function parseIntOrNull(s: string | undefined | null): number | null {
  const v = parseFloatOrNull(s);
  return v === null ? null : Math.trunc(v);
}

export function nonEmpty(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t ? t : null;
}

// A gap beyond 4-dp print rounding (≤ 5e-5 pc) means AT-HYG's HIP
// distance is NOT this HIP2 parallax and the curated value wins —
// see scripts/catalog/README.md § Per-row pipeline (HIP 57146).
const HIP_DIST_MATCH_TOLERANCE_PC = 1e-3;

/** The membership gates a spine row can still fail. Every one is pinned at 0
 *  in build-catalog-expected.json, so a non-zero entry fails the build rather
 *  than dropping a record the spine promised — see ../spine/README.md
 *  § The membership gates still run, and must stay at zero. */
export interface ReadStarsDrops {
  noRaDec: number;
  noDist: number;
  noDirection: number;
  tooFar: number;
  noVMagnitude: number;
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
  bjMap?: Map<string, number>;
  simbadSpectral?: SimbadSpectralIndex;
  /** Bibcoded SIMBAD values over the § 5 cohort — the rv cascade's bottom
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
  /** Printed Gliese V/70A values keyed on the record's own `gl` — the V
   *  cascade's tier below Tycho-2, and the only one reaching the GJ-only
   *  cohort. Absent costs those rows their V, hence their record. */
  gliese?: GlieseIndex;
  dustGrid?: DustGrid | null;
}

export function readStars(
  spineTsvPath: string,
  {
    conAssignment,
    bjMap = new Map(),
    simbadSpectral = emptySimbadSpectralIndex(),
    simbadValues = emptySimbadValueIndex(),
    apsisMap = new Map(),
    gspcMap = new Map(),
    directions = {
      gaiaAstrometry: new Map(),
      hip2: new Map(),
      nssSourceIds: new Set(),
      tycho2: new Map(),
      cns5: new Map(),
    },
    hipVMag = new Map(),
    hipBv = new Map(),
    gliese = emptyGlieseIndex(),
    dustGrid = null,
  }: ReadStarsOptions,
): {
  stars: Star[];
  stats: {
    total: number;
    dropped: ReadStarsDrops;
    bjEligible: number;            // rows with a Gaia DR3 source_id
    bjOverridden: number;          // bjEligible rows that hit a B-J entry
    bjOverriddenByDistSrc: DistSrcPartition;   // bjOverridden split by AT-HYG dist_src
    hipDistFullPrecision: number;  // dist_src=HIP rows re-derived from HIP2 parallax
    lmcCandidates: number;         // rows inside the LMC sky cone (any PM)
    lmcOverridden: number;         // lmcCandidates passing the PM gate (snapped to LMC)
    lmcOverriddenByDistSrc: DistSrcPartition;  // lmcOverridden split by AT-HYG dist_src
    directionVia: Record<DirectionVia, number>; // per-tier direction-cascade routing
    vVia: Record<VVia, number>;    // per-tier V-magnitude cascade routing
    vTycho2OutsideBtVtRange: number; // tycho2-tier rows outside SP-1200's published BT−VT range
    directionTycho2FromIcrs: number;    // tycho2-tier rows placed at the J2000 cell, no mean solution
    directionTycho2Photocentre: number; // tycho2-tier rows whose mean solution is a double's photocentre
    velocityVia: Record<VelocityVia, number>;   // per-tier space-motion PM-source routing
    pmRescueVia: Record<PmRescueVia, number>;   // rescue-cascade routing over the rows the direction tier left without a PM
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
    spectralByCurated: number;     // rows classified via the curated HIP→sp_type override tier
    spectralBySimbad: number;      // rows whose spectral classification came from SIMBAD sp_type
    spectralSimbadKey: Record<SimbadNamespace, number>; // which namespace found that row
    spectralByGspspec: number;     // rows that fell through to Gaia DR3 GSP-Spec spectraltype_esphs
    spectralFallback: number;      // rows with neither SIMBAD nor GSP-Spec — classIdx=8/lumClass=255
    ciVia: Record<CiVia, number>;  // per-tier B−V cascade routing
    ciGspcValidatedRange: number;  // gspc-tier rows the archive calls in-range
  };
} {
  const spineRows = iterSpineTsv(readFileSync(spineTsvPath, 'utf8'));

  const stars: Star[] = [];
  // Every spine row already passed each of these in the build it snapshots,
  // so all five are zero by construction. They stay as the assertion that the
  // spine and the reference tables it was frozen against still agree — a
  // refreshed table that moves a row past MAX_DIST_PC would otherwise drop a
  // record the spine promised.
  const dropped: ReadStarsDrops = {
    noRaDec: 0,
    noDist: 0,
    noDirection: 0,
    tooFar: 0,
    noVMagnitude: 0,
  };
  let total = 0;
  let bjEligible = 0;
  let bjOverridden = 0;
  const bjOverriddenByDistSrc = emptyDistSrcPartition();
  let hipDistFullPrecision = 0;
  let lmcCandidates = 0;
  let lmcOverridden = 0;
  const lmcOverriddenByDistSrc = emptyDistSrcPartition();
  const directionVia = emptyTallyPartition(DIRECTION_VIA_VALUES);
  const vVia = emptyTallyPartition(V_VIA_VALUES);
  const velocityVia = emptyTallyPartition(VELOCITY_VIA_VALUES);
  const pmRescueVia = emptyTallyPartition(PM_RESCUE_VIA_VALUES);
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
  let spectralByCurated = 0;
  let spectralBySimbad = 0;
  let spectralByGspspec = 0;
  let spectralFallback = 0;

  for (const row of spineRows) {
    total++;
    const ra = parseFloatOrNull(row.ra);   // hours
    const dec = parseFloatOrNull(row.dec); // degrees
    if (ra === null || dec === null) {
      dropped.noRaDec++;
      continue;
    }
    const athygDist = parseFloatOrNull(row.dist);
    if (athygDist === null) {
      dropped.noDist++;
      continue;
    }

    const hip = parseIntOrNull(row.hip);
    // Printed proper motion (mas/yr, cos δ-applied). Its only remaining
    // consumer is the LMC override's bulk-PM gate — the velocity assembly
    // takes its PM from whichever tier the direction cascade selected.
    const athygPmRa = parseFloatOrNull(row.pm_ra);
    const athygPmDec = parseFloatOrNull(row.pm_dec);
    // Read off the spine column, never re-derived: the native → HIP-cross-walk
    // precedence and both binding gates ran when the spine was generated, and
    // re-running them here would re-decide a binding the spine froze.
    const gaiaSourceId = nonEmpty(row.gaia_source_id);
    const gaiaRow = gaiaSourceId !== null
      ? directions.gaiaAstrometry.get(gaiaSourceId) ?? null
      : null;

    // Radial velocity through Gaia DR3 → bibcoded SIMBAD, feeding the
    // space-motion velocity's radial term.
    // See ../distance/radial-velocity/README.md.
    const simbadKeys: SimbadRecordKeys = {
      sourceId: gaiaSourceId,
      hip,
      tyc: nonEmpty(row.tyc),
      gl: nonEmpty(row.gl),
    };
    const simbadRow = lookupSimbadValues(simbadValues, simbadKeys);
    const rvRes = resolveRadialVelocity(gaiaRow, simbadRow?.rv ?? null);
    // A radial term past the sanity ceiling on its own is rejected here rather
    // than left to the whole-vector clamp below, which would drop the row's
    // measured proper motion with it.
    const rvRejected = radialTermExceedsCeiling(rvRes.rvKmS);
    const rvKmS = rvRejected ? null : rvRes.rvKmS;
    rvVia[rvRes.via]++;
    if (rvRes.gaiaBibcodeCited) rvSimbadGaiaBibcode++;
    if (rvRes.gaiaBibcodeSkipped) rvGaiaBibcodeSkipped++;
    if (rvRes.via === 'gaia_dr3' && gaiaRow !== null) {
      const rvErr = gaiaRow.radialVelocityErrorKmS;
      rvGaiaErrorBand[rvErrorBand(rvErr)]++;
      if (rvErr !== null && rvErr > rvGaiaErrorMaxKmS) rvGaiaErrorMaxKmS = rvErr;
    }

    // Bailer-Jones (DR3) override fires when (a) the row resolves to a
    // Gaia source_id by either path above and (b) dist_src marks the
    // catalogued distance as a Gaia inverse (G_R3 / G_R2). Other
    // dist_src values (HIP / GJ / N / OTHER) carry a non-Gaia parallax;
    // applying B-J there would silently move low-S/N rows to ~10–40 kpc
    // via the Galactic-density prior tail. See
    // docs/science-catalog-ingestion.md § Bailer-Jones DR3 distance
    // override (Layer 1).
    const athygDistSrc = nonEmpty(row.dist_src);
    const bjEligibleRow = isBailerJonesEligible(gaiaSourceId, athygDistSrc);
    let dist = athygDist;
    if (bjEligibleRow) bjEligible++;
    if (bjEligibleRow && bjMap.size > 0) {
      const ovr = applyBailerJonesOverride(gaiaSourceId, bjMap);
      if (ovr !== null) {
        dist = ovr;
        bjOverridden++;
        tallyDistSrc(bjOverriddenByDistSrc, athygDistSrc);
      }
    }

    // dist_src=HIP: re-derive the same catalogued distance as
    // 1000/plx at full precision from the committed HIP2 file.
    if (athygDistSrc === DIST_SRC_HIP && hip !== null) {
      const hip2 = directions.hip2.get(hip);
      if (hip2 !== undefined && hip2.plxMas !== null && hip2.plxMas > 0) {
        const hip2Dist = 1000 / hip2.plxMas;
        if (Math.abs(hip2Dist - athygDist) <= HIP_DIST_MATCH_TOLERANCE_PC) {
          dist = hip2Dist;
          hipDistFullPrecision++;
        }
      }
    }

    // LMC kinematic override: B-J's Galactic-density prior pulls real
    // LMC supergiants to ~5-20 kpc instead of 49.59 kpc. Sky-cone + bulk-PM
    // filter snaps the ~60 affected AT-HYG rows back to Pietrzyński 2019's
    // eclipsing-binary distance. Runs AFTER B-J so it overrides B-J's
    // mis-anchored value on the same rows.
    if (isInLmcCone(ra, dec)) {
      lmcCandidates++;
      const ovr = applyLmcKinematicOverride(ra, dec, athygPmRa, athygPmDec);
      if (ovr !== null) {
        dist = ovr;
        lmcOverridden++;
        tallyDistSrc(lmcOverriddenByDistSrc, athygDistSrc);
      }
    }

    if (dist > MAX_DIST_PC) {
      dropped.tooFar++;
      continue;
    }

    const proper = nonEmpty(row.proper);
    const isSol = proper === SOL_PROPER_NAME;

    // One lookup serves both cascades that read this row: the direction tier
    // takes its position and PM, the V cascade its BT/VT.
    const tycho2Row = simbadKeys.tyc !== null
      ? directions.tycho2.get(simbadKeys.tyc) ?? null
      : null;

    // Sky direction through the Gaia 5p → HIP2 → Tycho-2 → CNS5 → SIMBAD
    // cascade; position is direction × distance, both float64 until the
    // float32 pack at write time.
    const dirRes = resolveDirection(
      { ...simbadKeys, simbad: simbadRow?.astrometry ?? null, isSol },
      directions,
    );
    if (dirRes === null) {
      dropped.noDirection++;
      continue;
    }
    directionVia[dirRes.via]++;
    if (dirRes.via === 'tycho2' && tycho2Row !== null) {
      if (tycho2Row.fromIcrs) directionTycho2FromIcrs++;
      if (tycho2Row.isPhotocentre) directionTycho2Photocentre++;
    }
    const x = dirRes.dir.x * dist;
    const y = dirRes.dir.y * dist;
    const z = dirRes.dir.z * dist;

    // V through the Riello transform → printed HIP V → Tycho-2's reduced VT →
    // Gliese's printed Vmag → curated. See ../photometry/README.md. absmag
    // then derives from that V and the distance the whole override stack
    // settled on — except for Sol, which sits at distance zero where the
    // modulus is undefined and takes SOL_ABSOLUTE_V_MAGNITUDE instead.
    const glieseRow = lookupGliese(gliese, simbadKeys.gl);
    const tychoV = tycho2VMagnitude(
      tycho2Row?.btMag ?? null, tycho2Row?.vtMag ?? null,
    );
    const vRes = resolveVMagnitude(
      gaiaRow,
      printedByHip(hipVMag, hip),
      tychoV.v,
      glieseRow?.vMag ?? null,
      isSol ? SOL_APPARENT_V_MAGNITUDE : null,
    );
    vVia[vRes.via]++;
    if (vRes.via === 'tycho2' && tychoV.outsideRange) vTycho2OutsideBtVtRange++;
    if (vRes.v === null) {
      dropped.noVMagnitude++;
      continue;
    }
    let absmag = isSol
      ? SOL_ABSOLUTE_V_MAGNITUDE
      : apparentToAbsoluteMagnitude(vRes.v, dist);

    // The direction tier supplies the PM wherever its own solution carries
    // one. Where it does not — the 2p Gaia cohort, Tycho-2's rows with no mean
    // solution — the tangential term re-keys on the record's own designations
    // rather than shipping static. See ../distance/README.md § The
    // proper-motion rescue cascade.
    const pmRescue = !isSol && dirRes.velVia === 'zero'
      ? resolvePmRescue(
          {
            tycho2: tycho2Row,
            cns5: lookupCns5Astrometry(directions.cns5, simbadKeys.gl)?.pm ?? null,
            simbad: simbadRow?.astrometry?.pm ?? null,
          },
          gaiaRow !== null && !gaiaHas5pSolution(gaiaRow),
        )
      : null;
    if (pmRescue !== null) pmRescueVia[pmRescue.via]++;
    const velVia = pmRescue === null
      ? dirRes.velVia
      : VELOCITY_VIA_BY_PM_RESCUE[pmRescue.via];

    // Space-motion velocity from the direction tier's own position + the PM
    // resolved above + the final stack distance + the rv cascade's radial
    // term. Sol carries no PM row and sits at the origin — force it to exactly
    // zero so the advance pass leaves the world origin fixed.
    let vel = isSol
      ? { x: 0, y: 0, z: 0 }
      : velocityPcPerYr(
          dirRes.srcRaDeg, dirRes.srcDecDeg,
          pmRescue === null ? dirRes.srcPmraMasyr : pmRescue.pmRaMasyr,
          pmRescue === null ? dirRes.srcPmdecMasyr : pmRescue.pmDecMasyr,
          dist, rvKmS,
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
        `${idLabel()}: ${rvRes.rvKmS?.toFixed(1)} km/s @ ${dist.toFixed(1)} pc`,
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
    const spectral = isSol
      ? { info: classifyFromSimbad('G2V')!, source: 'curated' as const, spectDisplay: 'G2V' }
      : resolveSpectralInfo(simbadKeys, simbadSpectral, apsisMap);
    const spectInfo = spectral.info;
    if (spectral.source === 'curated') spectralByCurated++;
    else if (spectral.source === 'simbad') spectralBySimbad++;
    else if (spectral.source === 'gspspec') spectralByGspspec++;
    else spectralFallback++;
    if (spectral.simbadKey !== undefined) spectralSimbadKey[spectral.simbadKey]++;
    const apsisTeff = resolveApsisTeff(
      gaiaSourceId ? apsisMap.get(gaiaSourceId) : null,
    );

    // B−V through the Gaia relation → printed I/239 B−V → synthetic
    // photometry → intrinsic spectral class → solar. Printed above synthetic
    // inverts docs/catalog-driver.md § 5 — ../photometry/README.md § The ci
    // cascade. The baked value only drives colour for no-Apsis stars, which is
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
    let ci = ciRes.ci;
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
      if (ciRes.isObserved) ci -= av / R_V;
    }

    const physRadius = physicalRadius(absmag, spectInfo, apsisTeff);

    // Byte 34 is positional: the IAU boundaries partition the whole sphere,
    // so it resolves for any direction, catalogued or not. Sol is the one
    // record with no direction to resolve.
    const conIndex = isSol
      ? NO_CONSTELLATION_INDEX
      : conAssignment.indexAt(x, y, z);

    const bayer = nonEmpty(row.bayer);
    const flam = parseIntOrNull(row.flam);
    const hd = parseIntOrNull(row.hd);
    const hr = parseIntOrNull(row.hr);
    const spectDisplay = resolveSpectDisplay(spectral.spectDisplay, row.spect ?? '');

    let flags = 0;
    if (proper) flags |= FLAG_HAS_NAME;
    if (isSol) flags |= FLAG_IS_SOL;
    if (bayer) flags |= FLAG_HAS_BAYER;

    stars.push({
      x, y, z,
      vx: vel.x, vy: vel.y, vz: vel.z,
      absmag, ci,
      spectClass: spectInfo.classIdx,
      lumClass: spectInfo.lumClass,
      physicalRadius: physRadius,
      conIndex,
      // The spine carries no editorial `con` cell, so nothing here names a
      // designation's constellation. The GCVS pass supplies it downstream
      // where a designation carries one; everything else reads `conIndex`.
      desigConIndex: NO_CONSTELLATION_INDEX,
      flags,
      proper, bayer, hip, hd, hr, flam,
      gl: simbadKeys.gl,
      tyc: simbadKeys.tyc,
      gaiaSourceId,
      spectDisplay,
      companionIdx: -1,
      periodDays: 0,
      amplitudeMag: 0,
      varType: 0,
      gcvsName: null,
      athygDist,
      athygDistSrc,
      vVia: vRes.via,
      syntheticId: null,
    });
  }

  return {
    stars,
    stats: {
      total,
      dropped,
      bjEligible,
      bjOverridden,
      bjOverriddenByDistSrc,
      hipDistFullPrecision,
      lmcCandidates,
      lmcOverridden,
      lmcOverriddenByDistSrc,
      directionVia,
      vVia,
      velocityVia,
      pmRescueVia,
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
      spectralByCurated,
      spectralBySimbad,
      spectralSimbadKey,
      spectralByGspspec,
      spectralFallback,
      ciVia,
      ciGspcValidatedRange,
      vTycho2OutsideBtVtRange,
      directionTycho2FromIcrs,
      directionTycho2Photocentre,
    },
  };
}
