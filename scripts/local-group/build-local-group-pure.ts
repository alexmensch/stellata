// Pure helpers for build-local-group.ts: distance filter, override
// merge, orientation quaternions, display-name routing, and per-object
// emission assembly over emission-solver-pure.ts. Off the I/O path.

import {
  bnCoeff,
  discGeometryIntegral,
  fluxNumber,
  pnCoeff,
  sersicGeometryIntegral,
  solveDensity0,
  u99,
} from './emission-solver-pure';

/** Max heliocentric distance (parsecs) we render. 2 Mpc covers the
 *  canonical Local Group: M31 + M33 + their satellite subgroup, plus
 *  Sextans A/B and a handful of outer-band dwarfs that bleed past the
 *  ~1.5 Mpc IAU-style boundary. Beyond 2 Mpc we'd be picking up the
 *  IC 342 / Maffei groups — a separate decision.
 *
 *  Single source of truth — the runtime camera envelope in
 *  `src/client/stellata.ts` imports this and derives `CAMERA_FAR_PC`
 *  from it, so the build filter and the camera can never drift. */
export const MAX_DISTANCE_PC = 2_000_000;

/** Far plane for the runtime camera, paired with `MAX_DISTANCE_PC`.
 *  Sits 1 Mpc past `controls.maxDistance` (= `MAX_DISTANCE_PC`) so M31 /
 *  M33 + outer dwarfs render with comfort headroom when the camera
 *  reaches the maxDistance shell. */
export const CAMERA_FAR_PC = MAX_DISTANCE_PC + 1_000_000;

export type LgKind = 'disc' | 'ellipsoid';

export type EmissionFamily = 'sersic' | 'disc';

export interface OverrideRow {
  name: string;
  axes: [number, number, number];
  /** Raw orient string from the TSV (e.g. "disc:i=32,pa=135", "los",
   *  "pa:102"). Parsed by `buildOrientation` against the object's
   *  sky direction. */
  orient: string;
  refDoi: string;
  /** Optional standalone position. Populated only for rows that name
   *  objects not in LVDB (M31, M33). When present, the row builds a
   *  full LgObject without an LVDB merge; the three values must all be
   *  set together. When absent, the row supplements an LVDB row whose
   *  position drives the merge. */
  raDeg?: number;
  decDeg?: number;
  distanceKpc?: number;
  /** Integrated apparent V magnitude — standalone rows only (M31, M33);
   *  LVDB-merge rows take photometry from LVDB. */
  mV?: number;
  /** Emission profile family; empty falls to the family rule (Sérsic
   *  spheroid). Set "disc" for LMC, M31, M33. */
  profile?: EmissionFamily;
  /** Hand-curated Sérsic index override (M32 → 1.5). */
  nSersic?: number;
  /** Exponential-disc scale length, parsecs — disc-family rows. */
  rdPc?: number;
  /** Sérsic-bulge composite (M31). All three set together or none. */
  bulgeToTotal?: number;
  bulgeRePc?: number;
  bulgeN?: number;
  /** Profile-parameter source, separate from the structural refDoi. */
  refDoiProfile?: string;
  /** Optional population tint (hex, e.g. "#ffd9b0"); empty → the
   *  renderer's per-family default. */
  color?: string;
}

export interface LvdbRow {
  /** Slug key (e.g. "lmc", "sagittarius_1"). */
  key: string;
  /** Display name (e.g. "LMC"). */
  name: string;
  /** Right ascension, degrees (ICRS). */
  ra: number;
  /** Declination, degrees (ICRS). */
  dec: number;
  /** Heliocentric distance, kiloparsecs (LVDB native unit). */
  distanceKpc: number;
  /** Confirmed real (1) / candidate (0). */
  confirmedReal: number;
  /** Confirmed galaxy (1) / candidate (0). */
  confirmedGalaxy: number;
  /** Half-light radius in parsecs (LVDB rhalf_physical), or null. */
  rhalfPhysicalPc: number | null;
  /** Ellipticity e = 1 − b/a on the sky plane, or null. */
  ellipticity: number | null;
  /** Position angle of the projected major axis, degrees east of north
   *  on the sky plane, or null. */
  positionAngle: number | null;
  /** Integrated apparent V magnitude (as-observed), or null. */
  apparentMagV: number | null;
  /** Measured Sérsic index, or null (n = 1 fallback applies). */
  nSersic: number | null;
}

/** Solved Sérsic component — shared by the spheroid family and the
 *  M31 bulge (DRY at schema level). Axes in parsecs; density0 in the
 *  zero-point-free flux-number units of emission-solver-pure.ts. */
export interface SersicParams {
  reffAxesPc: [number, number, number];
  n: number;
  bn: number;
  pn: number;
  uMax: number;
  density0: number;
}

export type LgEmission =
  | ({ family: 'sersic'; mV: number; color?: string } & SersicParams)
  | {
      family: 'disc';
      mV: number;
      color?: string;
      rdPc: number;
      zdPc: number;
      rEnvPc: number;
      zEnvPc: number;
      density0: number;
      bulge?: SersicParams;
    };

/** Search crosswalk + morphological type row from aliases.tsv. */
export interface AliasRow {
  name: string;
  type: string;
  aliases: string[];
}

/** Morphological-type string for the search dropdown + focus card.
 *  Curated rows win; the default splits on the display-name suffix. */
export function objectTypeFor(displayName: string, curated?: string): string {
  if (curated) return curated;
  return displayName.endsWith(DEFAULT_TYPE_SUFFIX) ? 'Dwarf spheroidal' : 'Dwarf galaxy';
}

export interface LgObject {
  name: string;
  id: string;
  /** Morphological type for search rows + the focus card. */
  type: string;
  /** Extra typeable designations (catalog cross-IDs, common names). */
  aliases?: string[];
  /** Heliocentric ICRS position, parsecs. */
  center: [number, number, number];
  kind: LgKind;
  /** Local-frame semi-axes, parsecs. */
  axes: [number, number, number];
  /** Rotation from local frame to ICRS as a unit quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  source: 'LVDB' | 'OVERRIDE';
  /** Heliocentric distance to the centroid in parsecs — precomputed for
   *  ready-to-display readouts on the runtime side. */
  distance: number;
  emission: LgEmission;
}

/** Convert (RA, Dec, d) → ICRS heliocentric Cartesian [x, y, z]. RA/Dec
 *  in degrees; distance unit matches output unit. */
export function raDecDistanceToIcrs(
  raDeg: number,
  decDeg: number,
  distance: number,
): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cosDec = Math.cos(dec);
  return [
    distance * cosDec * Math.cos(ra),
    distance * cosDec * Math.sin(ra),
    distance * Math.sin(dec),
  ];
}

/** Build the sky-local orthonormal triple (ê_los, ê_east, ê_north)
 *  at the given RA/Dec in degrees. Returns vectors in ICRS.
 *
 *  Conventions:
 *  - ê_los = unit vector from Sol toward the object.
 *  - ê_east = perpendicular to ê_los in the equatorial plane, eastward.
 *    Degenerate at the celestial poles (cos Dec ≈ 0); we fall back to
 *    a fixed (0, 1, 0) basis seed there to keep the rotation well-defined.
 *  - ê_north = ê_los × ê_east (right-hand rule); points toward higher Dec
 *    everywhere except the poles, where the fallback gives a consistent
 *    orientation tied to ICRS +Y. */
export function skyBasis(raDeg: number, decDeg: number): {
  los: [number, number, number];
  east: [number, number, number];
  north: [number, number, number];
} {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cosDec = Math.cos(dec);
  const losX = cosDec * Math.cos(ra);
  const losY = cosDec * Math.sin(ra);
  const losZ = Math.sin(dec);

  let eastX: number, eastY: number, eastZ: number;
  if (Math.abs(cosDec) < 1e-9) {
    // Within ~0.2 arcsec of the pole — sky-east is degenerate. Use a
    // fallback basis seed; nothing in Local Group sits at the pole, but
    // the fallback keeps the basis defined for any future caller.
    eastX = 0; eastY = 1; eastZ = 0;
  } else {
    eastX = -Math.sin(ra);
    eastY = Math.cos(ra);
    eastZ = 0;
  }
  // north = los × east  (right-hand rule).
  const northX = losY * eastZ - losZ * eastY;
  const northY = losZ * eastX - losX * eastZ;
  const northZ = losX * eastY - losY * eastX;
  return {
    los: [losX, losY, losZ],
    east: [eastX, eastY, eastZ],
    north: [northX, northY, northZ],
  };
}

/** Build a unit quaternion [x, y, z, w] from an orthonormal basis matrix
 *  whose columns are the world-space directions of the local +X, +Y, +Z
 *  axes. Standard Shepperd's method (matches build-clouds.py). */
export function basisToQuaternion(
  bx: [number, number, number],
  by: [number, number, number],
  bz: [number, number, number],
): [number, number, number, number] {
  const m00 = bx[0], m10 = bx[1], m20 = bx[2];
  const m01 = by[0], m11 = by[1], m21 = by[2];
  const m02 = bz[0], m12 = bz[1], m22 = bz[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Parsed orient spec. Internal representation; the TSV string form is
 *  flattened by `parseOrient`. */
export type Orientation =
  | { kind: 'pa'; pa: number }
  | { kind: 'disc'; inclination: number; pa: number }
  | { kind: 'los' };

/** Parse the orient column of overrides.tsv. Throws on unrecognised
 *  shape — the override file is hand-curated, so a typo should fail
 *  loud at build time, not silently degrade to default rendering. */
export function parseOrient(s: string): Orientation {
  const trimmed = s.trim();
  if (trimmed === 'los') return { kind: 'los' };
  const paMatch = trimmed.match(/^pa:(-?\d+(?:\.\d+)?)$/);
  if (paMatch) return { kind: 'pa', pa: parseFloat(paMatch[1]) };
  const discMatch = trimmed.match(
    /^disc:i=(-?\d+(?:\.\d+)?),pa=(-?\d+(?:\.\d+)?)$/,
  );
  if (discMatch) {
    return {
      kind: 'disc',
      inclination: parseFloat(discMatch[1]),
      pa: parseFloat(discMatch[2]),
    };
  }
  throw new Error(`overrides.tsv: unrecognised orient '${s}'`);
}

/** Build the ICRS rotation quaternion for an object at (RA, Dec) with
 *  the given orientation spec. The local-frame convention used by the
 *  client renderer is:
 *
 *  - pa:    local a (+X) = sky-plane vector at PA east of north;
 *           local b (+Y) = sky-plane perpendicular;
 *           local c (+Z) = line of sight (away from Sol).
 *  - disc:  local x = line of nodes (sky-plane vector at PA);
 *           local z = disc normal (tilted by inclination from line of
 *           sight toward the side perpendicular to the line of nodes);
 *           local y = z × x (in the disc plane, completing right-handed).
 *  - los:   local c (+Z) = line of sight (away from Sol);
 *           local a (+X) = sky-east;  local b (+Y) = sky-north.
 *           (Pure radial orientation — used for SMC's line-of-sight
 *           elongation.) */
export function buildOrientationQuat(
  raDeg: number,
  decDeg: number,
  orient: Orientation,
): [number, number, number, number] {
  const { los, east, north } = skyBasis(raDeg, decDeg);
  if (orient.kind === 'los') {
    return basisToQuaternion(east, north, los);
  }
  if (orient.kind === 'pa') {
    const pa = (orient.pa * Math.PI) / 180;
    const cosPa = Math.cos(pa);
    const sinPa = Math.sin(pa);
    // a = sin(PA) · east + cos(PA) · north   (PA measured east of north)
    const aWorld: [number, number, number] = [
      sinPa * east[0] + cosPa * north[0],
      sinPa * east[1] + cosPa * north[1],
      sinPa * east[2] + cosPa * north[2],
    ];
    // b = ê_los × a — guarantees right-handed (a, b, c=los) basis so
    // Shepperd's method below produces a proper rotation quaternion.
    // Equivalent closed form: b = sin(PA)·ê_north − cos(PA)·ê_east, but
    // computing it as a cross product keeps the right-handedness
    // invariant explicit in the code.
    const bWorld: [number, number, number] = [
      los[1] * aWorld[2] - los[2] * aWorld[1],
      los[2] * aWorld[0] - los[0] * aWorld[2],
      los[0] * aWorld[1] - los[1] * aWorld[0],
    ];
    return basisToQuaternion(aWorld, bWorld, los);
  }
  // disc: i = inclination of disc plane from sky plane; pa = line of nodes.
  const i = (orient.inclination * Math.PI) / 180;
  const paAng = (orient.pa * Math.PI) / 180;
  const cosPa = Math.cos(paAng);
  const sinPa = Math.sin(paAng);
  // Line of nodes (local +X) — sky-plane vector at PA east of north.
  const xWorld: [number, number, number] = [
    sinPa * east[0] + cosPa * north[0],
    sinPa * east[1] + cosPa * north[1],
    sinPa * east[2] + cosPa * north[2],
  ];
  // Perpendicular to the nodes in the sky plane (tilt-axis seed).
  // At i=0 the disc normal = ê_los; at i=90° the disc normal = perp.
  // perp = sky-plane vector at (PA+90°): cos(PA)·east − sin(PA)·north.
  const perpX = cosPa * east[0] - sinPa * north[0];
  const perpY = cosPa * east[1] - sinPa * north[1];
  const perpZ = cosPa * east[2] - sinPa * north[2];
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  // Disc normal (local +Z) = cos(i)·ê_los + sin(i)·perp.
  const zWorld: [number, number, number] = [
    cosI * los[0] + sinI * perpX,
    cosI * los[1] + sinI * perpY,
    cosI * los[2] + sinI * perpZ,
  ];
  // y = z × x (in the disc plane, completing the right-handed basis).
  const yWorld: [number, number, number] = [
    zWorld[1] * xWorld[2] - zWorld[2] * xWorld[1],
    zWorld[2] * xWorld[0] - zWorld[0] * xWorld[2],
    zWorld[0] * xWorld[1] - zWorld[1] * xWorld[0],
  ];
  return basisToQuaternion(xWorld, yWorld, zWorld);
}

/** Build a slug from a display name (lower-case, kebab-case, ASCII only). */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'object'
  );
}

/** Filter LVDB rows to those that pass the rendering predicate:
 *  confirmed real, confirmed galaxy, valid ra/dec/distance, and within
 *  the MAX_DISTANCE_PC heliocentric envelope. */
export function filterForRendering(rows: LvdbRow[]): LvdbRow[] {
  return rows.filter((r) => {
    if (!Number.isFinite(r.ra) || !Number.isFinite(r.dec)) return false;
    if (!Number.isFinite(r.distanceKpc) || r.distanceKpc <= 0) return false;
    if (r.confirmedReal !== 1 || r.confirmedGalaxy !== 1) return false;
    return r.distanceKpc * 1000 <= MAX_DISTANCE_PC;
  });
}

/** Display-name overrides applied at output. LVDB's `name` column drives
 *  override-merge (overrides.tsv → LVDB row) and per-row identity, but
 *  the on-disk + on-screen display string is rewritten through this
 *  map for objects whose canonical name diverges from the LVDB
 *  shortform OR whose type-suffix differs from the default.
 *
 *  Catalog-designation names (M31, M 32, NGC 205, IC 10, etc.) are
 *  handled by `isCatalogDesignation` and bypass the type-suffix without
 *  needing an entry here. This map exists for the *named* dwarfs whose
 *  type is not the default dSph — dIrrs, dwarf transitions, and one-
 *  word proper names that read fine without a suffix. */
export const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  // LVDB's shortform is the SIMBAD-spaced "M 32"; the hand-curated
  // M31 / M33 rows carry no space, so normalise for consistency
  // across the three Messier members.
  'M 32': 'M32',
  LMC: 'Large Magellanic Cloud',
  SMC: 'Small Magellanic Cloud',
  'Leo A': 'Leo A',
  'Leo P': 'Leo P',
  WLM: 'WLM',
  Phoenix: 'Phoenix Dwarf',
  'LGS 3': 'LGS 3',
  'Pegasus dIrr': 'Pegasus Dwarf Irregular',
  'Pegasus W': 'Pegasus W',
  'Sextans A': 'Sextans A',
  'Sextans B': 'Sextans B',
  'Sagittarius dIrr': 'Sagittarius Dwarf Irregular',
  // LVDB "Aquarius" is DDO 210 (dTr / dIrr per McConnachie 2012),
  // distinct from the Aquarius II / III dSphs which keep the default
  // suffix. "Antlia B" is a transition dwarf per Hargis 2020.
  Aquarius: 'Aquarius Dwarf',
  'Antlia B': 'Antlia B Dwarf',
};

/** Default type suffix appended to LVDB names that aren't in the
 *  override map AND aren't catalog designations. Bare constellation
 *  names like "Sculptor", "Draco", "Hercules" collide with the
 *  constellation names without it; the suffix disambiguates and
 *  matches how astronomers refer to these objects in papers. */
export const DEFAULT_TYPE_SUFFIX = 'Dwarf Spheroidal';

/** True if the name reads as a galaxy-catalog designation — a recognised
 *  prefix (NGC, IC, UGC, UGCA, DDO, ESO, M, AGC, KK, KKR, KKH, KDG, PGC,
 *  HIPASS) followed by a digit, with optional whitespace. Catalog
 *  designations already self-identify and don't need a type suffix
 *  ("NGC 205" reads cleaner than "NGC 205 Dwarf Spheroidal"). */
export function isCatalogDesignation(name: string): boolean {
  return /^(NGC|IC|UGC|UGCA|DDO|ESO|M|AGC|KKR|KKH|KK|KDG|PGC|HIPASS)\s*\d/i.test(
    name,
  );
}

export function displayName(lvdbName: string): string {
  if (lvdbName in DISPLAY_NAME_OVERRIDES) return DISPLAY_NAME_OVERRIDES[lvdbName];
  if (isCatalogDesignation(lvdbName)) return lvdbName;
  return `${lvdbName} ${DEFAULT_TYPE_SUFFIX}`;
}

/** Default sky-plane oblate ellipsoid for an LVDB row with no override
 *  — uses rhalf_physical as the semi-major axis, ellipticity to derive
 *  the in-plane minor axis, and matches the minor axis along line of
 *  sight (axially symmetric around the projected major axis). Returns
 *  null if LVDB lacks the structural data we need. */
export function buildLvdbDefault(row: LvdbRow): {
  kind: LgKind;
  axes: [number, number, number];
  orient: Orientation;
} | null {
  if (row.rhalfPhysicalPc === null || row.rhalfPhysicalPc <= 0) return null;
  const e = row.ellipticity ?? 0;
  const a = row.rhalfPhysicalPc;
  const b = a * Math.max(0.05, 1 - e); // clamp so e≈1 doesn't collapse to a line
  const c = b; // axially symmetric around the projected major axis
  const pa = row.positionAngle ?? 0;
  return {
    kind: 'ellipsoid',
    axes: [a, b, c],
    orient: { kind: 'pa', pa },
  };
}

/** Sérsic index when LVDB has no measured fit and no override — inside
 *  the observed dwarf population (median 0.83) and the literature
 *  default for dSphs. */
export const SERSIC_N_FALLBACK = 1;

/** Disc vertical scale height convention: z_d = structural c / 3 — the
 *  shell sits at 3 scale heights ≈ 95% of the vertical light. */
export const DISC_ZD_SHELL_DIVISOR = 3;

/** Disc envelope rule: proxy extends to 4 scale lengths in plane and 4
 *  scale heights vertically (≥ the structural axes on both), matching
 *  the observed ~4–5 R_d disc truncations. The solver compensates
 *  whatever the envelope clips, so totals stay exact. */
export const DISC_ENV_SCALE_LENGTHS = 4;

/** Sky-projected semi-major axis of an override shell — the scale
 *  anchor matching the shell's shape to LVDB's projected half-light
 *  radius. Defined for the sky-aligned orients only; disc-orient
 *  objects take the disc emission family, never this path. */
export function projectedSemiMajorPc(
  axes: [number, number, number],
  orient: Orientation,
): number {
  if (orient.kind === 'disc') {
    throw new Error('projectedSemiMajorPc: disc-orient shells take the disc emission family');
  }
  return Math.max(axes[0], axes[1]);
}

/** Assemble the per-object emission block: family routing, R_e / disc
 *  geometry rules, envelope rules, and the DENSITY0 solve. Throws on
 *  unsatisfiable inputs (no photometry, disc without r_d_pc) — the
 *  build must fail loud rather than ship an uncalibratable object. */
export function buildEmission(opts: {
  row: LvdbRow | null;
  override: OverrideRow | undefined;
  /** Structural semi-axes from `overrides.tsv` / LVDB. The disc family's
   *  wireframe is derived back out of the emission block this returns
   *  (`renderedWireframeAxes`), so these are an input to the geometry,
   *  not the silhouette. */
  structuralAxes: [number, number, number];
  orient: Orientation;
  distancePc: number;
  name: string;
}): LgEmission {
  const { row, override, structuralAxes, orient, distancePc, name } = opts;
  const mV = override?.mV ?? row?.apparentMagV ?? null;
  if (mV === null) {
    throw new Error(`${name}: no apparent V magnitude in LVDB or overrides — cannot calibrate emission`);
  }
  const color = override?.color;
  const family: EmissionFamily = override?.profile ?? 'sersic';

  if (family === 'disc') {
    const rdPc = override?.rdPc;
    if (rdPc === undefined) {
      throw new Error(`${name}: disc profile requires r_d_pc in overrides.tsv`);
    }
    const zdPc = structuralAxes[2] / DISC_ZD_SHELL_DIVISOR;
    const rEnvPc = Math.max(DISC_ENV_SCALE_LENGTHS * rdPc, structuralAxes[0]);
    const zEnvPc = Math.max(DISC_ENV_SCALE_LENGTHS * zdPc, structuralAxes[2]);
    const bt = override?.bulgeToTotal ?? 0;
    const flux = fluxNumber(mV);
    const density0 = solveDensity0(
      distancePc,
      (1 - bt) * flux,
      discGeometryIntegral(rdPc, zdPc, rEnvPc, zEnvPc),
    );
    let bulge: SersicParams | undefined;
    if (bt > 0) {
      const rePc = override?.bulgeRePc;
      const n = override?.bulgeN;
      if (rePc === undefined || n === undefined) {
        throw new Error(`${name}: bulge_to_total requires bulge_re_pc and bulge_n`);
      }
      const uMax = u99(n);
      bulge = {
        reffAxesPc: [rePc, rePc, rePc],
        n,
        bn: bnCoeff(n),
        pn: pnCoeff(n),
        uMax,
        density0: solveDensity0(
          distancePc,
          bt * flux,
          sersicGeometryIntegral([rePc, rePc, rePc], n, uMax),
        ),
      };
    }
    return {
      family: 'disc',
      mV,
      ...(color ? { color } : {}),
      rdPc,
      zdPc,
      rEnvPc,
      zEnvPc,
      density0,
      ...(bulge ? { bulge } : {}),
    };
  }

  const n = override?.nSersic ?? row?.nSersic ?? SERSIC_N_FALLBACK;
  let reffAxesPc: [number, number, number];
  if (override) {
    // Structure papers keep the SHAPE; LVDB photometry keeps the
    // half-light SCALE: rescale the shell so its sky-projected
    // semi-major equals rhalf_physical.
    const rhalf = row?.rhalfPhysicalPc;
    if (rhalf === null || rhalf === undefined || rhalf <= 0) {
      throw new Error(`${name}: spheroid structure override without LVDB rhalf_physical — cannot scale the R_e ellipsoid`);
    }
    const s = rhalf / projectedSemiMajorPc(override.axes, orient);
    reffAxesPc = [override.axes[0] * s, override.axes[1] * s, override.axes[2] * s];
  } else {
    // Default path: the wireframe ellipsoid IS the R_e ellipsoid —
    // silhouette and glow share one geometry source.
    reffAxesPc = structuralAxes;
  }
  const uMax = Math.max(u99(n), structuralAxes[0] / reffAxesPc[0]);
  const density0 = solveDensity0(
    distancePc,
    fluxNumber(mV),
    sersicGeometryIntegral(reffAxesPc, n, uMax),
  );
  return {
    family: 'sersic',
    mV,
    ...(color ? { color } : {}),
    reffAxesPc,
    n,
    bn: bnCoeff(n),
    pn: pnCoeff(n),
    uMax,
    density0,
  };
}

/** Semi-axes the wireframe draws: the emission envelope for the disc
 *  family, the structural half-light ellipsoid for spheroids. Why the two
 *  families differ — see README.md § Emission solver. */
export function renderedWireframeAxes(
  structuralAxes: [number, number, number],
  emission: LgEmission,
): [number, number, number] {
  if (emission.family !== 'disc') return structuralAxes;
  return [emission.rEnvPc, emission.rEnvPc, emission.zEnvPc];
}

/** Assemble an LgObject from already-resolved fields. Both call sites
 *  (`mergeRowAndOverride` and `buildStandaloneOverride`) arrive at the
 *  same shape after they decide where axes/orient/position come from;
 *  the trailing `kind` derivation, ICRS conversion, quaternion build,
 *  and display-name / slug routing is identical. Centralised here so
 *  the two paths can never drift on rendering semantics. */
function buildLgObjectFromOrient(
  nameKey: string,
  idKey: string,
  raDeg: number,
  decDeg: number,
  distancePc: number,
  axes: [number, number, number],
  orient: Orientation,
  source: 'LVDB' | 'OVERRIDE',
  emission: LgEmission,
): LgObject {
  const kind: LgKind = orient.kind === 'disc' ? 'disc' : 'ellipsoid';
  const center = raDecDistanceToIcrs(raDeg, decDeg, distancePc);
  const quat = buildOrientationQuat(raDeg, decDeg, orient);
  const display = displayName(nameKey);
  return {
    name: display,
    id: slugify(idKey),
    type: objectTypeFor(display),
    center,
    kind,
    axes,
    quat,
    source,
    distance: distancePc,
    emission,
  };
}

/** Overlay a curated alias/type row onto a built object. The row is
 *  keyed by the source name (LVDB `name` / standalone override name),
 *  which the caller matches before the display-name rewrite. */
export function applyAliasMeta(obj: LgObject, meta: AliasRow | undefined): LgObject {
  if (!meta) return obj;
  obj.type = objectTypeFor(obj.name, meta.type);
  if (meta.aliases.length > 0) obj.aliases = meta.aliases;
  return obj;
}

/** Merge an LVDB row with an optional override into a fully-shaped
 *  LgObject. Override (when present) replaces axes + orient; LVDB
 *  always provides the position. Returns null when the row has no
 *  override AND no LVDB structural data — i.e. there's nothing to
 *  render. */
export function mergeRowAndOverride(
  row: LvdbRow,
  override: OverrideRow | undefined,
): LgObject | null {
  let axes: [number, number, number];
  let orient: Orientation;
  let source: 'LVDB' | 'OVERRIDE';
  if (override) {
    // Override wins on structure.
    orient = parseOrient(override.orient);
    axes = override.axes;
    source = 'OVERRIDE';
  } else {
    const lvdb = buildLvdbDefault(row);
    if (!lvdb) return null;
    axes = lvdb.axes;
    orient = lvdb.orient;
    source = 'LVDB';
  }
  const distancePc = row.distanceKpc * 1000;
  const emission = buildEmission({
    row,
    override,
    structuralAxes: axes,
    orient,
    distancePc,
    name: row.name,
  });
  return buildLgObjectFromOrient(
    row.name,
    row.key,
    row.ra,
    row.dec,
    distancePc,
    renderedWireframeAxes(axes, emission),
    orient,
    source,
    emission,
  );
}

/** Build a full LgObject from an override row that carries its own
 *  position (raDeg, decDeg, distanceKpc) — used for objects that aren't
 *  in LVDB at all (M31, M33; the LVDB `dwarf_all` table excludes the
 *  three major spirals). The row's distance must be ≤ MAX_DISTANCE_PC.
 *  Returns null if the row falls outside the envelope so the caller can
 *  log it and continue. */
export function buildStandaloneOverride(ov: OverrideRow): LgObject | null {
  if (ov.raDeg === undefined || ov.decDeg === undefined || ov.distanceKpc === undefined) {
    throw new Error(
      `overrides.tsv: '${ov.name}' has no LVDB match and no ra_deg/dec_deg/distance_kpc — cannot build position`,
    );
  }
  const distancePc = ov.distanceKpc * 1000;
  if (!Number.isFinite(distancePc) || distancePc <= 0) return null;
  if (distancePc > MAX_DISTANCE_PC) return null;
  const orient = parseOrient(ov.orient);
  const emission = buildEmission({
    row: null,
    override: ov,
    structuralAxes: ov.axes,
    orient,
    distancePc,
    name: ov.name,
  });
  return buildLgObjectFromOrient(
    ov.name,
    ov.name,
    ov.raDeg,
    ov.decDeg,
    distancePc,
    renderedWireframeAxes(ov.axes, emission),
    orient,
    'OVERRIDE',
    emission,
  );
}

/** Round a number to N decimal places. Strips JS float noise from
 *  output JSON so committed (gitignored) artifacts diff cleanly when
 *  regenerated. */
export function roundN(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/** Round to N significant digits — for quantities whose magnitude
 *  spans decades across the catalog (density0). */
export function roundSig(x: number, sig: number): number {
  if (x === 0) return 0;
  const mag = Math.ceil(Math.log10(Math.abs(x)));
  return roundN(x, sig - mag);
}
