// The public/binaries.bin wire layout, shared by its writer and the viewer's loader. See README.md.

import { J2000_JD } from '../../astro-core/astronomy-constants';

export const MAGIC = 'BIN1';
export const VERSION = 1;
export const HEADER_SIZE = 16;
export const RECORD_SIZE = 72;

/** Byte offset of each record field. Float64 fields sit on 8-byte
 *  boundaries; bytes 68..71 are reserved. */
export const RECORD_LAYOUT = {
  primary_idx: 0,
  secondary_idx: 4,
  flags: 8,
  parent_relation: 12,
  P_days: 16,
  T_jd: 24,
  e: 32,
  a_AU: 36,
  i_rad: 40,
  omega_rad: 44,
  Omega_rad: 48,
  q: 52,
  sep_arcsec: 56,
  pa_deg: 60,
  sep_pa_epoch_jd: 64,
} as const;

export const FLAG_HAS_ORBIT = 0x1;
export const FLAG_HAS_INCLINATION = 0x2;
export const FLAG_IS_INNER_OF_HIERARCHY = 0x4;

export const NO_PARENT = -1;

/** The six elements `FLAG_HAS_ORBIT` requires, null where absent. */
export type OrbitElementCells = Pick<BinaryElements, 'pDays' | 'tJd' | 'e' | 'aAU' | 'omegaRad' | 'q'>;

export type RenderableOrbit<T extends OrbitElementCells> = T & {
  readonly pDays: number; readonly tJd: number; readonly e: number;
  readonly aAU: number; readonly omegaRad: number; readonly q: number;
};

/** The `FLAG_HAS_ORBIT` rule: P, T, e, a, ω and q all present. */
export function hasRenderableOrbit<T extends OrbitElementCells>(row: T): row is RenderableOrbit<T> {
  return row.pDays !== null && row.tJd !== null && row.e !== null
    && row.aAU !== null && row.omegaRad !== null && row.q !== null;
}

/** A pair's orbital elements and WDS geometry, as each record carries them. */
export const BINARY_ELEMENT_KEYS = [
  'pDays', 'tJd', 'e', 'aAU', 'iRad', 'omegaRad', 'OmegaRad', 'q', 'sepArcsec', 'paDeg', 'sepPaEpochJd',
] as const;

export type BinaryElementKey = (typeof BINARY_ELEMENT_KEYS)[number];

/** Absent is null (NaN on the wire); `sepPaEpochJd` is an absolute JD. */
export type BinaryElements = { readonly [K in BinaryElementKey]: number | null };

export function pickBinaryElements(row: BinaryElements): BinaryElements {
  return Object.fromEntries(BINARY_ELEMENT_KEYS.map((k) => [k, row[k]])) as BinaryElements;
}

/** One record as written. */
export interface BinaryRecord extends BinaryElements {
  readonly primaryIdx: number;
  readonly secondaryIdx: number;
  readonly flags: number;
  readonly parentRelation: number;
}

export function encodeBinaries(records: readonly BinaryRecord[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE + records.length * RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < MAGIC.length; k++) bytes[k] = MAGIC.charCodeAt(k);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, records.length, true);
  records.forEach((r, i) => {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    const f32 = (field: keyof typeof RECORD_LAYOUT, v: number | null): void =>
      view.setFloat32(off + RECORD_LAYOUT[field], v ?? NaN, true);
    const f64 = (field: keyof typeof RECORD_LAYOUT, v: number | null): void =>
      view.setFloat64(off + RECORD_LAYOUT[field], v ?? NaN, true);
    view.setUint32(off + RECORD_LAYOUT.primary_idx, r.primaryIdx, true);
    view.setUint32(off + RECORD_LAYOUT.secondary_idx, r.secondaryIdx, true);
    view.setUint32(off + RECORD_LAYOUT.flags, r.flags, true);
    view.setInt32(off + RECORD_LAYOUT.parent_relation, r.parentRelation, true);
    f64('P_days', r.pDays);
    f64('T_jd', r.tJd);
    f32('e', r.e);
    f32('a_AU', r.aAU);
    f32('i_rad', r.iRad);
    f32('omega_rad', r.omegaRad);
    f32('Omega_rad', r.OmegaRad);
    f32('q', r.q);
    f32('sep_arcsec', r.sepArcsec);
    f32('pa_deg', r.paDeg);
    f32('sep_pa_epoch_jd', r.sepPaEpochJd === null ? null : r.sepPaEpochJd - J2000_JD);
  });
  return bytes;
}
