// AT-HYG CSV reader + Bailer-Jones / LMC distance overrides. The Star
// dataclass is the in-memory record shape every other parser in
// build-catalog reads or mutates (variability cross-match, doubles
// flag, name table, search index, binary writer). readStars produces
// it from AT-HYG v3.3 with per-row Bailer-Jones DR3 and LMC kinematic
// distance overrides applied; the override math itself lives in
// catalog-pure.ts.
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

import {
  parseSpectral,
  physicalRadius,
  isBailerJonesEligible,
  applyBailerJonesOverride,
  applyLmcKinematicOverride,
  isInLmcCone,
  resolveGaiaSourceId,
  parseGaiaSourceIdStr,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  FLAG_HAS_BAYER,
} from './catalog-pure';

// Drop stars farther than this from Sol. AT-HYG carries a handful of
// extragalactic stragglers (LMC supergiants pre-override, plus a few
// distant outliers) that the renderer's float32 origin can't keep
// stable; the LMC override snaps those back inside the cutoff before
// it fires.
const MAX_DIST_PC = 50_000;

// Used when the AT-HYG row's ci cell is blank. ~0.65 corresponds to a
// solar-type B-V, so a row with no colour falls back to a yellow disc
// in the renderer rather than a hot blue or cold red default.
const DEFAULT_CI = 0.65;

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
  x0: string; y0: string; z0: string;
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

export async function readStars(
  srcCsvPath: string,
  conIndexLookup: Map<string, number>,
  bjMap: Map<string, number>,
  hipToGaia: Map<number, string> | null = null,
): Promise<{
  stars: Star[];
  stats: {
    total: number;
    dropped: Record<string, number>;
    bjEligible: number;            // rows with a Gaia DR3 source_id
    bjOverridden: number;          // bjEligible rows that hit a B-J entry
    lmcCandidates: number;         // rows inside the LMC sky cone (any PM)
    lmcOverridden: number;         // lmcCandidates passing the PM gate (snapped to LMC)
    gaiaSourceIdBackfilled: number; // gaia-blank AT-HYG rows resolved via HIP→Gaia cross-walk
  };
}> {
  const parser = createReadStream(srcCsvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, cast: false })
  ) as AsyncIterable<AthygRow>;

  const stars: Star[] = [];
  const dropped: Record<string, number> = {
    noCoords: 0,
    noAbsmag: 0,
    tooFar: 0,
    unknownCon: 0,
  };
  let total = 0;
  let bjEligible = 0;
  let bjOverridden = 0;
  let lmcCandidates = 0;
  let lmcOverridden = 0;
  let gaiaSourceIdBackfilled = 0;

  for await (const row of parser) {
    total++;
    let x = parseFloatOrNull(row.x0);
    let y = parseFloatOrNull(row.y0);
    let z = parseFloatOrNull(row.z0);
    if (x === null || y === null || z === null) {
      dropped.noCoords++;
      continue;
    }
    let absmag = parseFloatOrNull(row.absmag);
    if (absmag === null) {
      dropped.noAbsmag++;
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
    const distSrc = nonEmpty(row.dist_src);
    const bjEligibleRow = isBailerJonesEligible(gaiaSourceId, distSrc);
    let dist = parseFloatOrNull(row.dist);
    const ra = parseFloatOrNull(row.ra);
    const dec = parseFloatOrNull(row.dec);
    const mag = parseFloatOrNull(row.mag);
    if (bjEligibleRow) bjEligible++;
    if (bjEligibleRow && bjMap.size > 0) {
      if (ra !== null && dec !== null && mag !== null) {
        const ovr = applyBailerJonesOverride(ra, dec, mag, gaiaSourceId, bjMap);
        if (ovr) {
          x = ovr.x; y = ovr.y; z = ovr.z;
          absmag = ovr.absmag;
          dist = ovr.dist;
          bjOverridden++;
        }
      }
    }

    // LMC kinematic override: B-J's Galactic-density prior pulls real
    // LMC supergiants to ~5-20 kpc instead of 49.59 kpc. Sky-cone + bulk-PM
    // filter snaps the ~60 affected AT-HYG rows back to Pietrzyński 2019's
    // eclipsing-binary distance. Runs AFTER B-J so it overrides B-J's
    // mis-anchored value on the same rows.
    if (ra !== null && dec !== null && mag !== null && isInLmcCone(ra, dec)) {
      lmcCandidates++;
      const pmRa = parseFloatOrNull(row.pm_ra);
      const pmDec = parseFloatOrNull(row.pm_dec);
      const ovr = applyLmcKinematicOverride(ra, dec, mag, pmRa, pmDec);
      if (ovr) {
        x = ovr.x; y = ovr.y; z = ovr.z;
        absmag = ovr.absmag;
        dist = ovr.dist;
        lmcOverridden++;
      }
    }

    if (dist !== null && dist > MAX_DIST_PC) {
      dropped.tooFar++;
      continue;
    }
    const ci = parseFloatOrNull(row.ci) ?? DEFAULT_CI;

    const spectRaw = (row.spect ?? '').trim();
    const spectInfo = parseSpectral(spectRaw);
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
    const spectDisplay = spectRaw
      ? spectRaw.replace(/\*+$/, '').trim().replace(/\s+/g, ' ')
      : null;

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
    });
  }

  return {
    stars,
    stats: {
      total,
      dropped,
      bjEligible,
      bjOverridden,
      lmcCandidates,
      lmcOverridden,
      gaiaSourceIdBackfilled,
    },
  };
}
