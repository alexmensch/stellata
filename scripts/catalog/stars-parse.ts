// AT-HYG CSV reader: per-row distance stack (Bailer-Jones / HIP2
// parallax / LMC overrides) × direction cascade → in-memory Star
// records for every downstream builder step. See scripts/catalog/README.md.
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

import {
  resolveSpectralInfo,
  resolveSpectDisplay,
  physicalRadius,
  isBailerJonesEligible,
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  apparentToAbsoluteMagnitude,
  isInLmcCone,
  resolveGaiaSourceId,
  parseGaiaSourceIdStr,
  SOLAR_BV_FALLBACK,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
  type ApsisRow,
  type SimbadSpectralIndex,
} from './catalog-pure';
import {
  resolveDirection,
  type DirectionSources,
  type DirectionVia,
} from './direction-cascade';

// Drop stars farther than this from Sol. AT-HYG carries a handful of
// extragalactic stragglers (LMC supergiants pre-override, plus a few
// distant outliers) that the renderer's float32 origin can't keep
// stable; the LMC override snaps those back inside the cutoff before
// it fires.
const MAX_DIST_PC = 50_000;

export interface Star {
  x: number; y: number; z: number;
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
    directionVia: Record<DirectionVia, number>; // per-tier direction-cascade routing
    spectralBySimbad: number;      // rows whose spectral classification came from SIMBAD sp_type
    spectralByGspspec: number;     // rows that fell through to Gaia DR3 GSP-Spec spectraltype_esphs
    spectralFallback: number;      // rows with neither SIMBAD nor GSP-Spec — classIdx=8/lumClass=255
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
  const directionVia: Record<DirectionVia, number> = {
    gaia_5p: 0,
    gaia_nss_systemic: 0,
    hip2_saturated: 0,
    hip2_pm_discrepant: 0,
    athyg_printed: 0,
  };
  let spectralBySimbad = 0;
  let spectralByGspspec = 0;
  let spectralFallback = 0;

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

    // Resolve the Gaia DR3 source_id: AT-HYG native > HIP cross-walk.
    // See resolveGaiaSourceId for the precedence + Gaia-saturated
    // bright-binary handling.
    const hip = parseIntOrNull(row.hip);
    const resolved = resolveGaiaSourceId(parseGaiaSourceIdStr(row.gaia), hip, hipToGaia);
    const gaiaSourceId = resolved.gaiaSourceId;
    if (resolved.backfilled) gaiaSourceIdBackfilled++;

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
    const mag = parseFloatOrNull(row.mag);
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
      const pmRa = parseFloatOrNull(row.pm_ra);
      const pmDec = parseFloatOrNull(row.pm_dec);
      const ovr = applyLmcKinematicOverride(mag, pmRa, pmDec);
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
    const dirRes = resolveDirection(gaiaSourceId, hip, ra, dec, directions);
    if (dirRes === null) {
      dropped.noDirection++;
      continue;
    }
    directionVia[dirRes.via]++;
    const x = dirRes.dir.x * dist;
    const y = dirRes.dir.y * dist;
    const z = dirRes.dir.z * dist;

    const ci = parseFloatOrNull(row.ci) ?? SOLAR_BV_FALLBACK;

    const spectral = resolveSpectralInfo(gaiaSourceId, hip, simbad, apsisMap);
    const spectInfo = spectral.info;
    if (spectral.source === 'simbad') spectralBySimbad++;
    else if (spectral.source === 'gspspec') spectralByGspspec++;
    else spectralFallback++;
    const physRadius = physicalRadius(absmag, spectInfo);

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

    const proper = nonEmpty(row.proper);
    const bayer = nonEmpty(row.bayer);
    const flam = parseIntOrNull(row.flam);
    const hd = parseIntOrNull(row.hd);
    const hr = parseIntOrNull(row.hr);
    const gl = nonEmpty(row.gl);
    const spectDisplay = resolveSpectDisplay(spectral.spectDisplay, row.spect ?? '');

    const isSol = proper === 'Sol';
    let flags = 0;
    if (proper) flags |= FLAG_HAS_NAME;
    if (isSol) flags |= FLAG_IS_SOL;
    if (bayer) flags |= FLAG_HAS_BAYER;

    stars.push({
      x, y, z, absmag, ci,
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
      directionVia,
      spectralBySimbad,
      spectralByGspspec,
      spectralFallback,
    },
  };
}
