// Parses public/binaries.bin into a typed record-set the runtime
// reads per frame. See /src/client/binaries/README.md#format-contract.

import {
  HEADER_LAYOUT, HEADER_SIZE, MAGIC, RECORD_SIZE, VERSION, decodeBinaryRecord, type DecodedBinaryRecord,
} from '../../catalog-format/binaries/binaries-format';
import { PUBLIC_FILES } from '../../catalog-format/public-artifacts/public-artifacts';

/** One pair, an absent element NaN. `parentRelation` indexes
 *  `BinariesData.relations`. */
export type BinaryRelation = DecodedBinaryRecord;

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
  const bytes = new Uint8Array(buf, HEADER_LAYOUT.magic, MAGIC.length);
  const decoder = new TextDecoder('ascii');
  const magic = decoder.decode(bytes);
  if (magic !== MAGIC) {
    throw new BinariesParseError({
      kind: 'magic',
      message: `${PUBLIC_FILES.binaries} magic "${magic}" does not match "${MAGIC}"`,
    });
  }
  const version = view.getUint32(HEADER_LAYOUT.version, true);
  if (version !== VERSION) {
    throw new BinariesParseError({
      kind: 'version',
      message: `${PUBLIC_FILES.binaries} version ${version} unsupported (expected ${VERSION})`,
    });
  }
  const count = view.getUint32(HEADER_LAYOUT.count, true);
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
  for (let i = 0; i < count; i++) relations[i] = decodeBinaryRecord(view, HEADER_SIZE + i * RECORD_SIZE);

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
