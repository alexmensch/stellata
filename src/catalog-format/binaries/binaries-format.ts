// The public/binaries.bin wire layout, shared by its writer and the viewer's loader. See README.md.

import { J2000_JD } from '../../astro-core/astronomy-constants';

export const MAGIC = 'BIN1';
export const VERSION = 1;
export const HEADER_SIZE = 16;
export const RECORD_SIZE = 72;

/** Byte offset of each header field; bytes 12..15 are reserved. */
export const HEADER_LAYOUT = { magic: 0, version: 4, count: 8 } as const;

/** `f32_j2000` is a JD stored as a float32 offset from J2000_JD. */
type WireType = 'u32' | 'i32' | 'f64' | 'f32' | 'f32_j2000';

/** Float64 fields stay on 8-byte boundaries; bytes 68..71 are reserved. */
export const RECORD_LAYOUT = {
  primaryIdx: { offset: 0, type: 'u32' },
  secondaryIdx: { offset: 4, type: 'u32' },
  flags: { offset: 8, type: 'u32' },
  parentRelation: { offset: 12, type: 'i32' },
  pDays: { offset: 16, type: 'f64' },
  tJd: { offset: 24, type: 'f64' },
  e: { offset: 32, type: 'f32' },
  aAU: { offset: 36, type: 'f32' },
  iRad: { offset: 40, type: 'f32' },
  omegaRad: { offset: 44, type: 'f32' },
  OmegaRad: { offset: 48, type: 'f32' },
  q: { offset: 52, type: 'f32' },
  sepArcsec: { offset: 56, type: 'f32' },
  paDeg: { offset: 60, type: 'f32' },
  sepPaEpochJd: { offset: 64, type: 'f32_j2000' },
} as const satisfies Record<string, { readonly offset: number; readonly type: WireType }>;

export const FLAG_HAS_ORBIT = 0x1;
export const FLAG_HAS_INCLINATION = 0x2;
export const FLAG_IS_INNER_OF_HIERARCHY = 0x4;

export const NO_PARENT = -1;

type RecordKey = keyof typeof RECORD_LAYOUT;
const INDEX_KEYS = ['primaryIdx', 'secondaryIdx', 'flags', 'parentRelation'] as const;
type IndexKey = (typeof INDEX_KEYS)[number];

/** A pair's orbital elements and WDS geometry: every record field but the
 *  four indices and flags. */
export type BinaryElementKey = Exclude<RecordKey, IndexKey>;
export const BINARY_ELEMENT_KEYS = (Object.keys(RECORD_LAYOUT) as RecordKey[])
  .filter((k): k is BinaryElementKey => !(INDEX_KEYS as readonly string[]).includes(k));

/** Absent is null (NaN on the wire); `sepPaEpochJd` is an absolute JD. */
export type BinaryElements = { readonly [K in BinaryElementKey]: number | null };

export function pickBinaryElements(row: BinaryElements): BinaryElements {
  return Object.fromEntries(BINARY_ELEMENT_KEYS.map((k) => [k, row[k]])) as BinaryElements;
}

/** One record as written. */
export type BinaryRecord = BinaryElements & { readonly [K in IndexKey]: number };

/** One record as read back: an absent element is NaN. */
export type DecodedBinaryRecord = { [K in RecordKey]: number };

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

const FIELDS = Object.entries(RECORD_LAYOUT) as [RecordKey, { offset: number; type: WireType }][];

function writeField(view: DataView, at: number, type: WireType, v: number | null): void {
  switch (type) {
    case 'u32': view.setUint32(at, v as number, true); break;
    case 'i32': view.setInt32(at, v as number, true); break;
    case 'f64': view.setFloat64(at, v ?? NaN, true); break;
    case 'f32': view.setFloat32(at, v ?? NaN, true); break;
    case 'f32_j2000': view.setFloat32(at, v === null ? NaN : v - J2000_JD, true); break;
  }
}

function readField(view: DataView, at: number, type: WireType): number {
  switch (type) {
    case 'u32': return view.getUint32(at, true);
    case 'i32': return view.getInt32(at, true);
    case 'f64': return view.getFloat64(at, true);
    case 'f32': return view.getFloat32(at, true);
    case 'f32_j2000': return view.getFloat32(at, true) + J2000_JD;
  }
}

export function encodeBinaries(records: readonly BinaryRecord[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE + records.length * RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < MAGIC.length; k++) bytes[HEADER_LAYOUT.magic + k] = MAGIC.charCodeAt(k);
  view.setUint32(HEADER_LAYOUT.version, VERSION, true);
  view.setUint32(HEADER_LAYOUT.count, records.length, true);
  records.forEach((r, i) => {
    const off = HEADER_SIZE + i * RECORD_SIZE;
    for (const [key, { offset, type }] of FIELDS) writeField(view, off + offset, type, r[key]);
  });
  return bytes;
}

/** The record at byte `off` of a `binaries.bin` view. */
export function decodeBinaryRecord(view: DataView, off: number): DecodedBinaryRecord {
  const out = {} as DecodedBinaryRecord;
  for (const [key, { offset, type }] of FIELDS) out[key] = readField(view, off + offset, type);
  return out;
}
