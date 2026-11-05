// Parses public/binaries.bin into a typed record-set the runtime
// reads per frame. See /src/client/binaries/README.md#format-contract.

import { J2000_JD } from '../../astro-core/astronomy-constants';
import {
  HEADER_SIZE, MAGIC, RECORD_LAYOUT, RECORD_SIZE, VERSION,
} from '../../catalog-format/binaries/binaries-format';
import { PUBLIC_FILES } from '../../catalog-format/public-artifacts/public-artifacts';

export interface BinaryRelation {
  /** Catalog.bin record index of the primary. */
  primaryIdx: number;
  /** Catalog.bin record index of the secondary. */
  secondaryIdx: number;
  /** Bitfield. bit 0 has_orbit, bit 1 has_inclination, bit 2 is_inner_of_hierarchy. */
  flags: number;
  /** Index INTO this BinariesData.relations of the outer pair when
   *  nested; NO_PARENT (-1) for top-level pairs. */
  parentRelation: number;
  /** Orbital period, days. NaN when has_orbit=0. */
  pDays: number;
  /** Periastron-passage epoch, JD. NaN when has_orbit=0. */
  tJd: number;
  /** Eccentricity. NaN when has_orbit=0. */
  e: number;
  /** Semi-major axis, AU. NaN when has_orbit=0. */
  aAU: number;
  /** Inclination, radians. NaN when has_inclination=0. */
  iRad: number;
  /** Argument of periastron, radians. */
  omegaRad: number;
  /** Longitude of ascending node, radians. */
  OmegaRad: number;
  /** Mass-fraction split q = M_secondary / (M_primary + M_secondary).
   *  Primary moves by −q·R, secondary by +(1−q)·R about the barycentre.
   *  Range (0, 0.5] when the brighter side is the primary. */
  q: number;
  /** WDS, at `sepPaEpochJd`. */
  sepArcsec: number;
  /** WDS position angle, degrees east of north, at sep_pa_epoch_jd. */
  paDeg: number;
  /** Absolute JD. On the wire it is a float32 offset from J2000_JD
   *  (2451545.0), so float32 keeps ~minute precision instead of the
   *  ~0.3-day loss the full JD would force; the loader adds J2000_JD
   *  back. */
  sepPaEpochJd: number;
}

export interface BinariesData {
  /** Format version field from the header. */
  version: number;
  /** All emitted pair relations, walked in topological (outer-before-
   *  inner) order — index `parentRelation` is always less than the
   *  child's index in this array. */
  relations: BinaryRelation[];
  /** Primary catalog row index → indices into `relations` where that
   *  row is the primary side of a pair. A primary can host several
   *  relations (Castor / α Cen multi-pair systems). */
  primaryIdxToRelations: Map<number, number[]>;
  /** Secondary catalog row index → its `relations` indices. One-to-many:
   *  HD 108250 = α Cru C is the measured secondary of both A and B. */
  secondaryIdxToRelations: Map<number, number[]>;
}

export interface BinariesLoadError {
  kind: 'fetch' | 'magic' | 'version' | 'truncated';
  message: string;
}

export class BinariesParseError extends Error {
  readonly kind: BinariesLoadError['kind'];
  constructor(err: BinariesLoadError) {
    super(err.message);
    this.kind = err.kind;
  }
}

export function parseBinaries(buf: ArrayBuffer): BinariesData {
  if (buf.byteLength < HEADER_SIZE) {
    throw new BinariesParseError({
      kind: 'truncated',
      message: `${PUBLIC_FILES.binaries} too short (${buf.byteLength} < ${HEADER_SIZE}-byte header)`,
    });
  }
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf, 0, 4);
  const decoder = new TextDecoder('ascii');
  const magic = decoder.decode(bytes);
  if (magic !== MAGIC) {
    throw new BinariesParseError({
      kind: 'magic',
      message: `${PUBLIC_FILES.binaries} magic "${magic}" does not match "${MAGIC}"`,
    });
  }
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new BinariesParseError({
      kind: 'version',
      message: `${PUBLIC_FILES.binaries} version ${version} unsupported (expected ${VERSION})`,
    });
  }
  const count = view.getUint32(8, true);
  const expectedLen = HEADER_SIZE + count * RECORD_SIZE;
  if (buf.byteLength < expectedLen) {
    throw new BinariesParseError({
      kind: 'truncated',
      message:
        `${PUBLIC_FILES.binaries} truncated: expected ${expectedLen} bytes for ${count} ` +
        `records, got ${buf.byteLength}`,
    });
  }

  const relations: BinaryRelation[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    relations[i] = {
      primaryIdx: view.getUint32(off + RECORD_LAYOUT.primary_idx, true),
      secondaryIdx: view.getUint32(off + RECORD_LAYOUT.secondary_idx, true),
      flags: view.getUint32(off + RECORD_LAYOUT.flags, true),
      parentRelation: view.getInt32(off + RECORD_LAYOUT.parent_relation, true),
      pDays: view.getFloat64(off + RECORD_LAYOUT.P_days, true),
      tJd: view.getFloat64(off + RECORD_LAYOUT.T_jd, true),
      e: view.getFloat32(off + RECORD_LAYOUT.e, true),
      aAU: view.getFloat32(off + RECORD_LAYOUT.a_AU, true),
      iRad: view.getFloat32(off + RECORD_LAYOUT.i_rad, true),
      omegaRad: view.getFloat32(off + RECORD_LAYOUT.omega_rad, true),
      OmegaRad: view.getFloat32(off + RECORD_LAYOUT.Omega_rad, true),
      q: view.getFloat32(off + RECORD_LAYOUT.q, true),
      sepArcsec: view.getFloat32(off + RECORD_LAYOUT.sep_arcsec, true),
      paDeg: view.getFloat32(off + RECORD_LAYOUT.pa_deg, true),
      sepPaEpochJd:
        view.getFloat32(off + RECORD_LAYOUT.sep_pa_epoch_jd, true) + J2000_JD,
    };
  }

  const primaryIdxToRelations = new Map<number, number[]>();
  const secondaryIdxToRelations = new Map<number, number[]>();
  for (let i = 0; i < relations.length; i++) {
    const r = relations[i];
    const arr = primaryIdxToRelations.get(r.primaryIdx);
    if (arr) arr.push(i);
    else primaryIdxToRelations.set(r.primaryIdx, [i]);
    const sArr = secondaryIdxToRelations.get(r.secondaryIdx);
    if (sArr) sArr.push(i);
    else secondaryIdxToRelations.set(r.secondaryIdx, [i]);
  }

  return { version, relations, primaryIdxToRelations, secondaryIdxToRelations };
}

/**
 * Fetch binaries.bin and parse it. Returns null when the file is
 * absent (404 or network error) or is some other payload (the magic-byte
 * mismatch) so the renderer can fall through
 * to a "no orbital animation, static placements only" path. Throws
 * `BinariesParseError` only on a present-but-malformed payload whose
 * header magic IS `BIN1` — version mismatch or truncated tail — since
 * those are the signals of a real data-pipeline bug.
 */
export async function loadBinaries(url: string): Promise<BinariesData | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 4) return null;
  const magic = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, 4));
  if (magic !== MAGIC) return null;
  return parseBinaries(buf);
}
