// The public/binaries.bin wire layout, shared by its writer and the viewer's loader. See README.md.

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
export interface OrbitElementCells {
  readonly pDays: number | null;
  readonly tJd: number | null;
  readonly e: number | null;
  readonly aAU: number | null;
  readonly omegaRad: number | null;
  readonly q: number | null;
}

export type RenderableOrbit<T extends OrbitElementCells> = T & {
  readonly pDays: number; readonly tJd: number; readonly e: number;
  readonly aAU: number; readonly omegaRad: number; readonly q: number;
};

/** The `FLAG_HAS_ORBIT` rule: P, T, e, a, ω and q all present. */
export function hasRenderableOrbit<T extends OrbitElementCells>(row: T): row is RenderableOrbit<T> {
  return row.pDays !== null && row.tJd !== null && row.e !== null
    && row.aAU !== null && row.omegaRad !== null && row.q !== null;
}
