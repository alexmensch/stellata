// AT-HYG CSV reader: per-row distance stack (Bailer-Jones / HIP2
// parallax / LMC overrides) × direction cascade → in-memory Star
// records for every downstream builder step. See scripts/catalog/README.md.
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

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
  resolveGaiaSourceId,
  parseGaiaSourceIdStr,
  spectralClassCi,
  spectralClassColorIsDerivable,
  SOLAR_BV_FALLBACK,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  type ApsisRow,
  type SimbadSpectralIndex,
  type SimbadWdsXidIndex,
} from './catalog-pure';
import {
  resolveDirection,
  velocityPcPerYr,
  KM_S_TO_PC_YR,
  VELOCITY_SANITY_CEILING_PC_YR,
  GALACTIC_ESCAPE_VELOCITY_PC_YR,
  type DirectionSources,
  type DirectionVia,
  type VelocityVia,
} from './direction-cascade';
import { R_V, avSolToStar, type DustGrid } from './dust-deextinction-pure';

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
  conIndex: number;
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
  // Build-time-only diagnostic fields. Captured from the AT-HYG row before
  // any override fires; consumed by the post-build distance-regression check
  // and NOT written to the binary.
  athygDist: number | null;     // AT-HYG `dist` column, pre-override
  athygDistSrc: string | null;  // AT-HYG `dist_src` column
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

// Subset of AT-HYG v3.3 columns this build script reads. Every column we
// touch must be declared here; a typo on `row.foo` then becomes a compile
// error rather than a silent `undefined` that corrupts the binary.
// `cast: false` keeps every cell as a string; the parseFloat/parseInt
// helpers below normalise them.
export interface AthygRow {
  absmag: string;
  dist: string;
  dist_src: string;
  ci: string;
  spect: string;
  con: string;
  proper: string;
  bayer: string;
  flam: string;
  hip: string;
  hd: string;
  hr: string;
  gl: string;
  ra: string;
  dec: string;
  mag: string;
  gaia: string;
  pm_ra: string;
  pm_dec: string;
  rv: string;
}

const DIST_SRC_HIP = 'HIP';

// A gap beyond 4-dp print rounding (≤ 5e-5 pc) means AT-HYG's HIP
// distance is NOT this HIP2 parallax and the curated value wins —
// see scripts/catalog/README.md § Per-row pipeline (HIP 57146).
const HIP_DIST_MATCH_TOLERANCE_PC = 1e-3;

export async function readStars(
  srcCsvPath: string,
  conIndexLookup: Map<string, number>,
  bjMap: Map<string, number>,
  hipToGaia: Map<number, string> | null = null,
  simbad: SimbadSpectralIndex = { bySource: new Map(), byHip: new Map() },
  apsisMap: Map<string, ApsisRow> = new Map(),
  directions: DirectionSources = {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
  },
  dustGrid: DustGrid | null = null,
  wdsXids: SimbadWdsXidIndex | null = null,
): Promise<{
  stars: Star[];
  stats: {
    total: number;
    dropped: Record<string, number>;
    bjEligible: number;            // rows with a Gaia DR3 source_id
    bjOverridden: number;          // bjEligible rows that hit a B-J entry
    hipDistFullPrecision: number;  // dist_src=HIP rows re-derived from HIP2 parallax
    lmcCandidates: number;         // rows inside the LMC sky cone (any PM)
    lmcOverridden: number;         // lmcCandidates passing the PM gate (snapped to LMC)
    gaiaSourceIdBackfilled: number; // gaia-blank AT-HYG rows resolved via HIP→Gaia cross-walk
    gaiaBindingMagRejected: number; // rows whose native/cross-walk binding failed the G−V gate
    gaiaBindingSiblingRejected: number; // rows whose binding SIMBAD attributes to a sibling WDS letter
    directionVia: Record<DirectionVia, number>; // per-tier direction-cascade routing
    velocityVia: Record<VelocityVia, number>;   // per-tier space-motion PM-source routing
    velocityClamped: number;       // rows whose artifact velocity exceeded the sanity ceiling → zeroed
    velocityClampedSample: string[]; // per-clamped-star "id: speed @ dist" for build-log review
    velocityAboveEscape: number;   // kept rows above the Galactic escape velocity (tracked ratchet)
    velocityAboveEscapeSample: string[]; // capped sample of above-escape stars for build-log review
    rvApplied: number;             // rows whose velocity carries a non-zero AT-HYG radial velocity
    spectralByCurated: number;     // rows classified via the curated HIP→sp_type override tier
    spectralBySimbad: number;      // rows whose spectral classification came from SIMBAD sp_type
    spectralByGspspec: number;     // rows that fell through to Gaia DR3 GSP-Spec spectraltype_esphs
    spectralFallback: number;      // rows with neither SIMBAD nor GSP-Spec — classIdx=8/lumClass=255
    ciSpectralDerived: number;     // no-Apsis-Teff ∩ no-observed-B−V rows whose ci is baked from the spectral class (tier 4/5) instead of the solar fallback
  };
}> {
  const parser = createReadStream(srcCsvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, cast: false })
  ) as AsyncIterable<AthygRow>;

  const stars: Star[] = [];
  const dropped: Record<string, number> = {
    noRaDec: 0,
    noAbsmag: 0,
    noDist: 0,
    noDirection: 0,
    tooFar: 0,
    unknownCon: 0,
  };
  let total = 0;
  let bjEligible = 0;
  let bjOverridden = 0;
  let hipDistFullPrecision = 0;
  let lmcCandidates = 0;
  let lmcOverridden = 0;
  let gaiaSourceIdBackfilled = 0;
  let gaiaBindingMagRejected = 0;
  let gaiaBindingSiblingRejected = 0;
  const directionVia: Record<DirectionVia, number> = {
    gaia_5p: 0,
    gaia_nss_systemic: 0,
    hip2_saturated: 0,
    hip2_pm_discrepant: 0,
    athyg_printed: 0,
  };
  const velocityVia: Record<VelocityVia, number> = {
    gaia_pm: 0,
    hip2_pm: 0,
    athyg_pm: 0,
    zero: 0,
  };
  let rvApplied = 0;
  let velocityClamped = 0;
  const velocityClampedSample: string[] = [];
  let velocityAboveEscape = 0;
  const velocityAboveEscapeSample: string[] = [];
  let spectralByCurated = 0;
  let spectralBySimbad = 0;
  let spectralByGspspec = 0;
  let spectralFallback = 0;
  let ciSpectralDerived = 0;

  for await (const row of parser) {
    total++;
    const ra = parseFloatOrNull(row.ra);   // hours
    const dec = parseFloatOrNull(row.dec); // degrees
    if (ra === null || dec === null) {
      dropped.noRaDec++;
      continue;
    }
    let absmag = parseFloatOrNull(row.absmag);
    if (absmag === null) {
      dropped.noAbsmag++;
      continue;
    }
    const athygDist = parseFloatOrNull(row.dist);
    if (athygDist === null) {
      dropped.noDist++;
      continue;
    }

    // Resolve the Gaia DR3 source_id: AT-HYG native > HIP cross-walk,
    // both vetted against the G−V magnitude gate. See
    // resolveGaiaSourceId for the precedence + Gaia-saturated
    // bright-binary handling.
    const hip = parseIntOrNull(row.hip);
    const mag = parseFloatOrNull(row.mag);
    // AT-HYG proper motion (mas/yr, cos δ-applied) + radial velocity
    // (km/s). Feed the LMC PM gate, the athyg_printed velocity tier, and
    // the space-motion velocity's radial term. rv is Gaia RVS on 258k
    // rows (rv_src=G_R3); used directly, zero when blank.
    const athygPmRa = parseFloatOrNull(row.pm_ra);
    const athygPmDec = parseFloatOrNull(row.pm_dec);
    const rvKmS = parseFloatOrNull(row.rv);
    const resolved = resolveGaiaSourceId(
      parseGaiaSourceIdStr(row.gaia), hip, hipToGaia, mag,
      (id) => directions.gaiaAstrometry.get(id)?.gMag ?? null,
      wdsXids,
    );
    const gaiaSourceId = resolved.gaiaSourceId;
    if (resolved.backfilled) gaiaSourceIdBackfilled++;
    if (resolved.magRejected) gaiaBindingMagRejected++;
    if (resolved.siblingRejected) gaiaBindingSiblingRejected++;

    // Bailer-Jones (DR3) override fires when (a) the row resolves to a
    // Gaia source_id by either path above and (b) dist_src marks the
    // catalogued distance as a Gaia inverse (G_R3 / G_R2). Other
    // dist_src values (HIP / GJ / N / OTHER) carry a non-Gaia parallax;
    // applying B-J there would silently move low-S/N rows to ~10–40 kpc
    // via the Galactic-density prior tail. See SCIENCE.md § Distances /
    // Bailer-Jones DR3 override.
    const athygDistSrc = nonEmpty(row.dist_src);
    const bjEligibleRow = isBailerJonesEligible(gaiaSourceId, athygDistSrc);
    let dist = athygDist;
    if (bjEligibleRow) bjEligible++;
    if (bjEligibleRow && bjMap.size > 0 && mag !== null) {
      const ovr = applyBailerJonesOverride(mag, gaiaSourceId, bjMap);
      if (ovr) {
        absmag = ovr.absmag;
        dist = ovr.dist;
        bjOverridden++;
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
          if (mag !== null) absmag = apparentToAbsoluteMagnitude(mag, dist);
          hipDistFullPrecision++;
        }
      }
    }

    // LMC kinematic override: B-J's Galactic-density prior pulls real
    // LMC supergiants to ~5-20 kpc instead of 49.59 kpc. Sky-cone + bulk-PM
    // filter snaps the ~60 affected AT-HYG rows back to Pietrzyński 2019's
    // eclipsing-binary distance. Runs AFTER B-J so it overrides B-J's
    // mis-anchored value on the same rows.
    if (mag !== null && isInLmcCone(ra, dec)) {
      lmcCandidates++;
      const ovr = applyLmcKinematicOverride(mag, athygPmRa, athygPmDec);
      if (ovr) {
        absmag = ovr.absmag;
        dist = ovr.dist;
        lmcOverridden++;
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
    const isSol = proper === 'Sol';

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
      : resolveSpectralInfo(gaiaSourceId, hip, simbad, apsisMap);
    const spectInfo = spectral.info;
    if (spectral.source === 'curated') spectralByCurated++;
    else if (spectral.source === 'simbad') spectralBySimbad++;
    else if (spectral.source === 'gspspec') spectralByGspspec++;
    else spectralFallback++;
    const apsisTeff = resolveApsisTeff(
      gaiaSourceId ? apsisMap.get(gaiaSourceId) : null,
    );

    // ci routing mirrors the shipped shader's two-tier read
    // (`iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi`): an Apsis-Teff
    // star ignores iCi, so the baked ci only drives colour for no-Apsis
    // stars. An observed B−V wins; otherwise a no-Apsis star bakes its
    // intrinsic spectral-class colour (tier 4/5) here rather than
    // rendering solar-yellow. spectralClassCi routes an unparseable
    // class back to the solar fallback.
    const ciRaw = parseFloatOrNull(row.ci);
    const ciIsObserved = ciRaw !== null;
    let ci: number;
    if (ciIsObserved) {
      ci = ciRaw;
    } else if (apsisTeff === null) {
      ci = spectralClassCi(spectInfo);
      if (spectralClassColorIsDerivable(spectInfo)) ciSpectralDerived++;
    } else {
      ci = SOLAR_BV_FALLBACK;
    }

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
      if (ciIsObserved) ci -= av / R_V;
    }

    const physRadius = physicalRadius(absmag, spectInfo, apsisTeff);

    const conCode: string = (row.con ?? '').trim();
    let conIndex = 255;
    if (conCode) {
      const idx = conIndexLookup.get(conCode.toLowerCase());
      if (idx === undefined) {
        dropped.unknownCon++;
      } else {
        conIndex = idx;
      }
    }

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
      conIndex, flags,
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
      hipDistFullPrecision,
      lmcCandidates,
      lmcOverridden,
      gaiaSourceIdBackfilled,
      gaiaBindingMagRejected,
      gaiaBindingSiblingRejected,
      directionVia,
      velocityVia,
      velocityClamped,
      velocityClampedSample,
      velocityAboveEscape,
      velocityAboveEscapeSample,
      rvApplied,
      spectralByCurated,
      spectralBySimbad,
      spectralByGspspec,
      spectralFallback,
      ciSpectralDerived,
    },
  };
}
