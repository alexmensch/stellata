// Per-row sky-direction resolution for the catalog build: Gaia DR3 5p →
// HIP2 → AT-HYG printed ra/dec, with proper-motion propagation to the
// J2016.0 scene epoch. See scripts/catalog/README.md § Direction resolution.

export const GAIA_DR3_REF_EPOCH = 2016.0;
export const HIP2_REF_EPOCH = 1991.25;
// Gaia DR3's native epoch: the catalogue-wide scene epoch every position
// is normalised onto. The dominant Gaia set lands here with zero
// propagation; only the HIP2 / AT-HYG minority advances. The binaries
// pipeline mirrors this in scripts/binaries/stage6_multiples.py — keep
// the two in sync (see data/README.md § Reference epoch and proper motion).
export const CATALOG_SCENE_EPOCH = 2016.0;

// Gaia 5p reliability + HIP2-preference thresholds, mirrored from
// scripts/binaries/stage3_astrometry.py so both pipelines route a shared
// star identically.
export const GAIA_RUWE_UNRELIABLE_THRESHOLD = 1.4;
export const GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 0.02;
export const HIP2_PM_DELTA_THRESHOLD_MASYR = 50.0;

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);
const DEG_TO_RAD = Math.PI / 180;

/** 5p astrometry row from `data/gaia/gaia_dr3_astrometry_catalog.tsv`.
 *  ra/dec are at J2016.0. `parallaxMas === null` marks a 2p
 *  (position-only) solution — Gaia detected the source but could not
 *  fit parallax + PM. */
export interface GaiaAstrometryCatalogRow {
  raDeg: number;
  decDeg: number;
  parallaxMas: number | null;
  pmraMasyr: number | null;
  pmdecMasyr: number | null;
  ruwe: number | null;
  ipdFracMultiPeak: number | null;
}

/** van Leeuwen 2007 reduction row from
 *  `data/hipparcos/hip2_van_leeuwen.tsv`. ra/dec are at J1991.25. */
export interface Hip2AstrometryRow {
  raDeg: number;
  decDeg: number;
  plxMas: number | null;
  pmRaMasyr: number | null;
  pmDeMasyr: number | null;
}

/** The three reference datasets the cascade routes between. Empty
 *  maps/sets degrade gracefully: every row falls through to
 *  `athyg_printed` and the build-counts assertion flags the drift. */
export interface DirectionSources {
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
  hip2: Map<number, Hip2AstrometryRow>;
  nssSourceIds: Set<string>;
}

export const DIRECTION_VIA_VALUES = [
  'gaia_5p',
  'gaia_nss_systemic',
  'hip2_saturated',
  'hip2_pm_discrepant',
  'athyg_printed',
] as const;

export type DirectionVia = (typeof DIRECTION_VIA_VALUES)[number];

export interface UnitVector {
  x: number;
  y: number;
  z: number;
}

export interface DirectionResolution {
  via: DirectionVia;
  dir: UnitVector;
}

/** ICRS (ra, dec) in degrees → unit vector in the equatorial Cartesian
 *  basis catalog.bin uses (x toward RA 0h, z toward the north celestial
 *  pole). Multiplying by distance in pc yields the record xyz. */
export function unitVectorFromRaDec(raDeg: number, decDeg: number): UnitVector {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const cosDec = Math.cos(dec);
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  };
}

/** Sky direction at `toEpoch` for a source measured at `fromEpoch` —
 *  RV-free linear space-motion form (accuracy budget + the
 *  perspective-acceleration omission are in scripts/catalog/README.md
 *  § Direction resolution).
 *
 *  `pmraMasyr` is Gaia/HIP2's μ_α* — the cos δ-applied east-component
 *  rate. Do NOT divide by cos δ before calling. Either PM component
 *  missing → the measured position is returned unpropagated (best
 *  available estimate, matches stage2_resolve.py's convention). */
export function directionAtEpoch(
  raDeg: number,
  decDeg: number,
  pmraMasyr: number | null,
  pmdecMasyr: number | null,
  fromEpoch: number,
  toEpoch: number,
): UnitVector {
  const u = unitVectorFromRaDec(raDeg, decDeg);
  if (pmraMasyr === null || pmdecMasyr === null) return u;
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const sinRa = Math.sin(ra);
  const cosRa = Math.cos(ra);
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  // Local tangent basis: east = ∂u/∂α / cos δ, north = ∂u/∂δ.
  const eastX = -sinRa;
  const eastY = cosRa;
  const eastZ = 0;
  const northX = -sinDec * cosRa;
  const northY = -sinDec * sinRa;
  const northZ = cosDec;
  const dt = toEpoch - fromEpoch;
  const dEast = pmraMasyr * MAS_TO_RAD * dt;
  const dNorth = pmdecMasyr * MAS_TO_RAD * dt;
  const x = u.x + dEast * eastX + dNorth * northX;
  const y = u.y + dEast * eastY + dNorth * northY;
  const z = u.z + dEast * eastZ + dNorth * northZ;
  const norm = Math.hypot(x, y, z);
  return { x: x / norm, y: y / norm, z: z / norm };
}

/** RUWE / ipd_frac_multi_peak orbit-corruption indicators on the 5p fit.
 *  Same pair of gates as stage3_astrometry.py's `gaia_5p_unreliable`. */
export function gaia5pUnreliable(row: GaiaAstrometryCatalogRow): boolean {
  if (row.ruwe !== null && row.ruwe > GAIA_RUWE_UNRELIABLE_THRESHOLD) return true;
  if (
    row.ipdFracMultiPeak !== null
    && row.ipdFracMultiPeak > GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD
  ) return true;
  return false;
}

/** |Δμ| > 50 mas/yr on either axis between the Gaia 5p and HIP2 PMs.
 *  Missing PM on either side → no comparison possible → false. */
export function hip2PmDisagrees(
  gaia: GaiaAstrometryCatalogRow,
  hip2: Hip2AstrometryRow,
): boolean {
  if (
    gaia.pmraMasyr === null || gaia.pmdecMasyr === null
    || hip2.pmRaMasyr === null || hip2.pmDeMasyr === null
  ) return false;
  return (
    Math.abs(gaia.pmraMasyr - hip2.pmRaMasyr) > HIP2_PM_DELTA_THRESHOLD_MASYR
    || Math.abs(gaia.pmdecMasyr - hip2.pmDeMasyr) > HIP2_PM_DELTA_THRESHOLD_MASYR
  );
}

/** Resolve one AT-HYG row's J2016.0 sky direction through the trust
 *  cascade. Route semantics + priority order in
 *  scripts/catalog/README.md § Direction resolution; thresholds mirror
 *  scripts/binaries/stage3_astrometry.py. Returns null only when the
 *  row has no printed ra/dec either (never in practice — caller drops
 *  and counts). */
export function resolveDirection(
  gaiaSourceId: string | null,
  hip: number | null,
  athygRaHours: number | null,
  athygDecDeg: number | null,
  sources: DirectionSources,
): DirectionResolution | null {
  const gaia = gaiaSourceId !== null
    ? sources.gaiaAstrometry.get(gaiaSourceId)
    : undefined;
  const hip2 = hip !== null ? sources.hip2.get(hip) : undefined;

  if (gaia !== undefined && gaia.parallaxMas !== null) {
    const fromGaia = (via: DirectionVia): DirectionResolution => ({
      via,
      dir: directionAtEpoch(
        gaia.raDeg, gaia.decDeg, gaia.pmraMasyr, gaia.pmdecMasyr,
        GAIA_DR3_REF_EPOCH, CATALOG_SCENE_EPOCH,
      ),
    });
    if (
      gaiaSourceId !== null
      && sources.nssSourceIds.has(gaiaSourceId)
      && gaia5pUnreliable(gaia)
    ) {
      return fromGaia('gaia_nss_systemic');
    }
    if (hip2 !== undefined && hip2PmDisagrees(gaia, hip2)) {
      return {
        via: 'hip2_pm_discrepant',
        dir: directionAtEpoch(
          hip2.raDeg, hip2.decDeg, hip2.pmRaMasyr, hip2.pmDeMasyr,
          HIP2_REF_EPOCH, CATALOG_SCENE_EPOCH,
        ),
      };
    }
    return fromGaia('gaia_5p');
  }

  if (hip2 !== undefined) {
    return {
      via: 'hip2_saturated',
      dir: directionAtEpoch(
        hip2.raDeg, hip2.decDeg, hip2.pmRaMasyr, hip2.pmDeMasyr,
        HIP2_REF_EPOCH, CATALOG_SCENE_EPOCH,
      ),
    };
  }

  // 2p (position-only) Gaia row with no HIP2 cover: keep the Gaia
  // positional anchor, unpropagated when PM is absent — mirrors
  // stage3's gaia_5p fall-through.
  if (gaia !== undefined) {
    return {
      via: 'gaia_5p',
      dir: directionAtEpoch(
        gaia.raDeg, gaia.decDeg, gaia.pmraMasyr, gaia.pmdecMasyr,
        GAIA_DR3_REF_EPOCH, CATALOG_SCENE_EPOCH,
      ),
    };
  }

  if (athygRaHours === null || athygDecDeg === null) return null;
  return {
    via: 'athyg_printed',
    dir: unitVectorFromRaDec(athygRaHours * 15, athygDecDeg),
  };
}

// ---- TSV parsers ----------------------------------------------------------

function headerIndex(
  headerLine: string,
  cols: readonly string[],
  fileLabel: string,
  refreshHint: string,
): Record<string, number> {
  const header = headerLine.split('\t').map((h) => h.trim());
  const idx: Record<string, number> = Object.create(null);
  const missing: string[] = [];
  for (const c of cols) {
    const i = header.indexOf(c);
    if (i < 0) missing.push(c);
    idx[c] = i;
  }
  if (missing.length) {
    throw new Error(
      `${fileLabel} is missing required columns: ${missing.join(', ')}. ${refreshHint}`,
    );
  }
  return idx;
}

function floatCell(cells: string[], i: number): number | null {
  const s = (cells[i] ?? '').trim();
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Parse `data/gaia/gaia_dr3_astrometry_catalog.tsv` into a source_id →
 *  row map. source_id stays a string — Gaia IDs exceed
 *  Number.MAX_SAFE_INTEGER, so a numeric parse would corrupt the key. */
export function parseGaiaAstrometryCatalogTsv(
  text: string,
): Map<string, GaiaAstrometryCatalogRow> {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['source_id', 'ra', 'dec', 'parallax', 'pmra', 'pmdec', 'ruwe', 'ipd_frac_multi_peak'],
    'Gaia astrometry catalog TSV',
    'Re-run scripts/refresh/refresh-gaia-astrometry-catalog.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    const raDeg = floatCell(cells, idx.ra);
    const decDeg = floatCell(cells, idx.dec);
    if (raDeg === null || decDeg === null) continue;
    out.set(sourceId, {
      raDeg,
      decDeg,
      parallaxMas: floatCell(cells, idx.parallax),
      pmraMasyr: floatCell(cells, idx.pmra),
      pmdecMasyr: floatCell(cells, idx.pmdec),
      ruwe: floatCell(cells, idx.ruwe),
      ipdFracMultiPeak: floatCell(cells, idx.ipd_frac_multi_peak),
    });
  }
  return out;
}

/** Parse `data/hipparcos/hip2_van_leeuwen.tsv` into a HIP →
 *  Hip2AstrometryRow map. */
export function parseHip2Tsv(text: string): Map<number, Hip2AstrometryRow> {
  const out = new Map<number, Hip2AstrometryRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['hip', 'ra_icrs', 'de_icrs', 'plx', 'pm_ra', 'pm_de'],
    'HIP2 van Leeuwen TSV',
    'Restore data/hipparcos/hip2_van_leeuwen.tsv from LFS.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const hip = Number((cells[idx.hip] ?? '').trim());
    if (!Number.isInteger(hip) || hip <= 0) continue;
    const raDeg = floatCell(cells, idx.ra_icrs);
    const decDeg = floatCell(cells, idx.de_icrs);
    if (raDeg === null || decDeg === null) continue;
    out.set(hip, {
      raDeg,
      decDeg,
      plxMas: floatCell(cells, idx.plx),
      pmRaMasyr: floatCell(cells, idx.pm_ra),
      pmDeMasyr: floatCell(cells, idx.pm_de),
    });
  }
  return out;
}

/** Extract the set of Gaia DR3 source_ids carrying an NSS two-body
 *  orbit from `data/gaia/gaia_dr3_nss_two_body.tsv`. Only the first
 *  column is read — membership is the only signal the cascade needs. */
export function parseNssSourceIdSet(text: string): Set<string> {
  const out = new Set<string>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['source_id'],
    'Gaia NSS two-body TSV',
    'Re-run scripts/refresh/refresh-gaia-nss.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const sourceId = (line.split('\t')[idx.source_id] ?? '').trim();
    if (sourceId) out.add(sourceId);
  }
  return out;
}
