// Inherited-spine reader: per-row distance stack (Bailer-Jones / HIP2
// parallax / LMC overrides) × direction cascade → in-memory Star
// records for every downstream builder step. See scripts/catalog/README.md.
import { readFileSync } from 'node:fs';

import {
  classifyFromSimbad,
  resolveSpectralInfo,
  resolveSpectDisplay,
  resolveApsisTeff,
  physicalRadius,
  isBailerJonesEligible,
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  apparentToAbsoluteMagnitude,
  isInLmcCone,
  emptyDistSrcPartition,
  tallyDistSrc,
  DIST_SRC_HIP,
  spectralClassCi,
  spectralClassColorIsDerivable,
  SOL_ABSOLUTE_V_MAGNITUDE,
  SOL_PROPER_NAME,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  NO_CONSTELLATION_INDEX,
  type ApsisRow,
  type DistSrcPartition,
  type SimbadSpectralIndex,
} from '../catalog-pure';
import {
  resolveDirection,
  resolveRadialVelocity,
  velocityPcPerYr,
  DIRECTION_VIA_VALUES,
  VELOCITY_VIA_VALUES,
  RV_VIA_VALUES,
  KM_S_TO_PC_YR,
  VELOCITY_SANITY_CEILING_PC_YR,
  GALACTIC_ESCAPE_VELOCITY_PC_YR,
  type DirectionSources,
  type DirectionVia,
  type RvVia,
  type VelocityVia,
} from '../distance/direction-cascade';
import { R_V, avSolToStar, type DustGrid } from '../distance/dust-deextinction-pure';
import {
  resolveVMagnitude,
  V_VIA_VALUES,
  type VVia,
} from '../photometry/v-magnitude-pure';
import {
  resolveColourIndex,
  CI_VIA_VALUES,
  type CiVia,
} from '../photometry/colour-index-pure';
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
   *  scripts/catalog/README.md § Companion promotion. */
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
  apsisMap?: Map<string, ApsisRow>;
  directions?: DirectionSources;
  /** Printed Johnson V per HIP — the V cascade's bright tier. Absent leaves
   *  every saturated row on the catalogued cell, which shows up as vVia drift
   *  against the pinned count snapshot. */
  hipVMag?: Map<number, number>;
  dustGrid?: DustGrid | null;
}

export function readStars(
  spineTsvPath: string,
  {
    conAssignment,
    bjMap = new Map(),
    simbadSpectral = { bySource: new Map(), byHip: new Map() },
    apsisMap = new Map(),
    directions = {
      gaiaAstrometry: new Map(),
      hip2: new Map(),
      nssSourceIds: new Set(),
    },
    hipVMag = new Map(),
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
    velocityVia: Record<VelocityVia, number>;   // per-tier space-motion PM-source routing
    velocityClamped: number;       // rows whose artifact velocity exceeded the sanity ceiling → zeroed
    velocityClampedSample: string[]; // per-clamped-star "id: speed @ dist" for build-log review
    velocityAboveEscape: number;   // kept rows above the Galactic escape velocity (tracked ratchet)
    velocityAboveEscapeSample: string[]; // capped sample of above-escape stars for build-log review
    rvVia: Record<RvVia, number>;  // per-tier radial-velocity cascade routing
    rvApplied: number;             // rows whose velocity carries a non-zero radial velocity
    spectralByCurated: number;     // rows classified via the curated HIP→sp_type override tier
    spectralBySimbad: number;      // rows whose spectral classification came from SIMBAD sp_type
    spectralByGspspec: number;     // rows that fell through to Gaia DR3 GSP-Spec spectraltype_esphs
    spectralFallback: number;      // rows with neither SIMBAD nor GSP-Spec — classIdx=8/lumClass=255
    ciVia: Record<CiVia, number>;  // per-tier B−V cascade routing
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
  const rvVia = emptyTallyPartition(RV_VIA_VALUES);
  const ciVia = emptyTallyPartition(CI_VIA_VALUES);
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
    const mag = parseFloatOrNull(row.mag);
    // Printed proper motion (mas/yr, cos δ-applied). Feeds the LMC PM gate and
    // the athyg_printed velocity tier.
    const athygPmRa = parseFloatOrNull(row.pm_ra);
    const athygPmDec = parseFloatOrNull(row.pm_dec);
    // Read off the spine column, never re-derived: the native → HIP-cross-walk
    // precedence and both binding gates ran when the spine was generated, and
    // re-running them here would re-decide a binding the spine froze.
    const gaiaSourceId = nonEmpty(row.gaia_source_id);
    const gaiaRow = gaiaSourceId !== null
      ? directions.gaiaAstrometry.get(gaiaSourceId) ?? null
      : null;

    // Radial velocity through Gaia DR3 → the printed cell, feeding the
    // space-motion velocity's radial term. See ../distance/README.md.
    const rvRes = resolveRadialVelocity(gaiaRow, parseFloatOrNull(row.rv));
    const rvKmS = rvRes.rvKmS;
    rvVia[rvRes.via]++;

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

    // Sky direction through the Gaia 5p → HIP2 → AT-HYG cascade;
    // position is direction × distance, both float64 until the
    // float32 pack at write time.
    const dirRes = resolveDirection(
      gaiaSourceId, hip, ra, dec, directions, athygPmRa, athygPmDec,
    );
    if (dirRes === null) {
      dropped.noDirection++;
      continue;
    }
    directionVia[dirRes.via]++;
    const x = dirRes.dir.x * dist;
    const y = dirRes.dir.y * dist;
    const z = dirRes.dir.z * dist;

    const proper = nonEmpty(row.proper);
    const isSol = proper === SOL_PROPER_NAME;

    // V through the Riello transform → printed HIP V → catalogued cell, then
    // absmag from that V and the distance the whole override stack settled on.
    // See ../photometry/README.md. Sol is the one record this cannot reach:
    // it sits at distance zero, where the modulus is undefined.
    const vRes = resolveVMagnitude(
      gaiaRow,
      hip !== null ? hipVMag.get(hip) ?? null : null,
      mag,
    );
    vVia[vRes.via]++;
    if (vRes.v === null) {
      dropped.noVMagnitude++;
      continue;
    }
    let absmag = isSol
      ? SOL_ABSOLUTE_V_MAGNITUDE
      : apparentToAbsoluteMagnitude(vRes.v, dist);

    // Space-motion velocity from the SAME tier's solution + the final
    // stack distance + AT-HYG RV. Sol carries no PM row and sits at the
    // origin — force it to exactly zero so the advance pass leaves the
    // world origin fixed.
    let vel = isSol
      ? { x: 0, y: 0, z: 0 }
      : velocityPcPerYr(
          dirRes.srcRaDeg, dirRes.srcDecDeg,
          dirRes.srcPmraMasyr, dirRes.srcPmdecMasyr, dist, rvKmS,
        );
    // Physical sanity: a space velocity past the ceiling is a PM×distance
    // artifact (spurious PM on a faint distant star). Drop to zero — kept
    // at J2016.0, the same fall-through as no-PM rows — so it doesn't
    // streak under the epoch-advance. Sol is already zero.
    let velClamped = false;
    const speedPcYr = Math.hypot(vel.x, vel.y, vel.z);
    const idLabel = (): string => proper
      ?? (hip !== null ? `HIP ${hip}` : gaiaSourceId ? `Gaia ${gaiaSourceId}` : '(anon)');
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
    velocityVia[isSol || velClamped ? 'zero' : dirRes.velVia]++;
    if (velClamped) velocityClamped++;
    if (!isSol && !velClamped && rvKmS !== null && rvKmS !== 0) rvApplied++;

    // Sol carries no HIP, no Gaia source_id, and no SIMBAD row, so every
    // machine tier misses and the unknown-class 5000 K row misizes it
    // (R 1.27 instead of ~1.03) — the one record addressable only by name.
    const spectral = isSol
      ? { info: classifyFromSimbad('G2V')!, source: 'curated' as const, spectDisplay: 'G2V' }
      : resolveSpectralInfo(gaiaSourceId, hip, simbadSpectral, apsisMap);
    const spectInfo = spectral.info;
    if (spectral.source === 'curated') spectralByCurated++;
    else if (spectral.source === 'simbad') spectralBySimbad++;
    else if (spectral.source === 'gspspec') spectralByGspspec++;
    else spectralFallback++;
    const apsisTeff = resolveApsisTeff(
      gaiaSourceId ? apsisMap.get(gaiaSourceId) : null,
    );

    // B−V through the Gaia relation → printed cell → intrinsic spectral class →
    // solar. See ../photometry/README.md § The ci cascade. The baked value only
    // drives colour for no-Apsis stars, which is why the derived tiers gate on
    // apsisTeff.
    const ciRes = resolveColourIndex({
      photometry: gaiaRow,
      cataloguedCi: parseFloatOrNull(row.ci),
      apsisTeff,
      spectralCi: spectralClassColorIsDerivable(spectInfo)
        ? spectralClassCi(spectInfo)
        : null,
    });
    let ci = ciRes.ci;
    ciVia[ciRes.via]++;

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
    const gl = nonEmpty(row.gl);
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
      proper, bayer, hip, hd, hr, flam, gl,
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
      velocityClamped,
      velocityClampedSample,
      velocityAboveEscape,
      velocityAboveEscapeSample,
      rvVia,
      rvApplied,
      spectralByCurated,
      spectralBySimbad,
      spectralByGspspec,
      spectralFallback,
      ciVia,
    },
  };
}
