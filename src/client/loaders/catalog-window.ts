// See ./README.md § The catalog-decode worker.

import {
  APSIS_FIELDS,
  AMP_MAG_PER_UNIT,
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  NO_COMPANION,
  PERIOD_DAYS_PER_UNIT,
  RECORD_SIZE,
  decodeRecordColumn,
  decodeRecordColumnBig,
  type NumericRecordField,
  type RecordColumnSink,
  type RecordSpan,
} from '../../../scripts/catalog/record/catalog-pure';
import { writePulsationParams } from '../star-pipeline/pulsation/pulsation-params-pure';

export interface CatalogWindowColumns {
  positions: Float32Array;
  velocities: Float32Array;
  absmag: Float32Array;
  ci: Float32Array;
  physicalRadius: Float32Array;
  spectClass: Float32Array;
  luminosityClass: Uint8Array;
  constellation: Float32Array;
  flags: Uint8Array;
  companion: Int32Array;
  periodDays: Float32Array;
  amplitudeMag: Float32Array;
  varType: Uint8Array;
  pulsRho: Float32Array;
  pulsColorSwing: Float32Array;
  hip: Uint32Array;
  sid: Uint32Array;
  gaiaSourceId: BigUint64Array;
  multiplicityStatus: Uint8Array;
  teffGspphot: Float32Array;
  loggGspphot: Float32Array;
  mhGspphot: Float32Array;
  azeroGspphot: Float32Array;
  teffGspspec: Float32Array;
  loggGspspec: Float32Array;
  mhGspspec: Float32Array;
}

export type CatalogWindowColumn = keyof CatalogWindowColumns;

export interface CatalogWindow {
  first: number;
  count: number;
  columns: CatalogWindowColumns;
  /** Window-relative index of Sol, `-1` where the window does not hold it. */
  solIndex: number;
  namedAt: Uint32Array;
  namedOffsets: Uint32Array;
}

/** The columns `decodeRecordColumn` can write into — every key whose array
 *  the sink union accepts. `companion` and `gaiaSourceId` are outside it and
 *  decode through their own passes below. */
type DecodedColumnKey = {
  [K in CatalogWindowColumn]: CatalogWindowColumns[K] extends RecordColumnSink ? K : never;
}[CatalogWindowColumn];

interface DecodedColumn {
  key: DecodedColumnKey;
  fields: readonly NumericRecordField[];
  scale?: number;
}

const DECODED_COLUMNS: readonly DecodedColumn[] = [
  { key: 'positions', fields: ['x', 'y', 'z'] },
  { key: 'velocities', fields: ['vx', 'vy', 'vz'] },
  { key: 'absmag', fields: ['absmag'] },
  { key: 'ci', fields: ['ci'] },
  { key: 'physicalRadius', fields: ['physRadius'] },
  { key: 'spectClass', fields: ['spectClass'] },
  { key: 'luminosityClass', fields: ['lumClass'] },
  { key: 'constellation', fields: ['conIndex'] },
  { key: 'flags', fields: ['flags'] },
  { key: 'varType', fields: ['varType'] },
  { key: 'amplitudeMag', fields: ['ampUnits'], scale: AMP_MAG_PER_UNIT },
  { key: 'periodDays', fields: ['period'], scale: PERIOD_DAYS_PER_UNIT },
  { key: 'hip', fields: ['hip'] },
  { key: 'sid', fields: ['sid'] },
  { key: 'multiplicityStatus', fields: ['multiplicityStatus'] },
  ...APSIS_FIELDS.map((name) => ({ key: name, fields: [name] as const })),
];

export const CATALOG_WINDOW_COLUMNS: readonly (readonly [CatalogWindowColumn, number])[] = [
  ...DECODED_COLUMNS.map((c) => [c.key, c.fields.length] as const),
  ['companion', 1],
  ['gaiaSourceId', 1],
  ['pulsRho', 1],
  ['pulsColorSwing', 1],
];

/** Land one window column in its full-catalogue counterpart at element
 *  `at`. The two are the same key of the same interface, which no `set`
 *  overload can express across the union. */
export function copyWindowColumn(
  dst: CatalogWindowColumns[CatalogWindowColumn],
  src: CatalogWindowColumns[CatalogWindowColumn],
  at: number,
): void {
  (dst as unknown as { set(source: unknown, offset: number): void }).set(src, at);
}

export function allocateCatalogColumns(count: number): CatalogWindowColumns {
  return {
    positions: new Float32Array(count * 3),
    velocities: new Float32Array(count * 3),
    absmag: new Float32Array(count),
    ci: new Float32Array(count),
    physicalRadius: new Float32Array(count),
    spectClass: new Float32Array(count),
    luminosityClass: new Uint8Array(count),
    constellation: new Float32Array(count),
    flags: new Uint8Array(count),
    companion: new Int32Array(count),
    periodDays: new Float32Array(count),
    amplitudeMag: new Float32Array(count),
    varType: new Uint8Array(count),
    pulsRho: new Float32Array(count),
    pulsColorSwing: new Float32Array(count),
    hip: new Uint32Array(count),
    sid: new Uint32Array(count),
    gaiaSourceId: new BigUint64Array(count),
    multiplicityStatus: new Uint8Array(count),
    teffGspphot: new Float32Array(count),
    loggGspphot: new Float32Array(count),
    mhGspphot: new Float32Array(count),
    azeroGspphot: new Float32Array(count),
    teffGspspec: new Float32Array(count),
    loggGspspec: new Float32Array(count),
    mhGspspec: new Float32Array(count),
  };
}

/** Byte range of a record window, for a caller slicing the bytes a worker
 *  gets or aiming a `DataView` at record `first`. */
export function recordWindowBytes(
  recordsOffsetBytes: number,
  first: number,
  end: number,
): { start: number; length: number } {
  return {
    start: recordsOffsetBytes + first * RECORD_SIZE,
    length: (end - first) * RECORD_SIZE,
  };
}

/** Decode `count` records read from the start of `view`, which a caller has
 *  already aimed at record `first`. */
export function decodeCatalogWindow(
  view: DataView,
  first: number,
  count: number,
): CatalogWindow {
  const columns = allocateCatalogColumns(count);
  const span: RecordSpan = { offset: 0, first: 0, end: count };
  for (const { key, fields, scale } of DECODED_COLUMNS) {
    const out = columns[key];
    fields.forEach((field, component) => {
      decodeRecordColumn(view, span, field, out, { stride: fields.length, component, scale });
    });
  }
  decodeRecordColumnBig(view, span, 'gaiaSourceId', columns.gaiaSourceId);

  const companionRaw = new Uint32Array(count);
  const nameOffset = new Uint32Array(count);
  decodeRecordColumn(view, span, 'companion', companionRaw);
  decodeRecordColumn(view, span, 'nameOffset', nameOffset);

  const { companion, flags } = columns;
  const namedAt: number[] = [];
  const namedOffsets: number[] = [];
  let solIndex = -1;
  for (let i = 0; i < count; i++) {
    companion[i] = companionRaw[i] === NO_COMPANION ? -1 : companionRaw[i];
    if (flags[i] & FLAG_IS_SOL) solIndex = i;
    if (flags[i] & FLAG_HAS_NAME) {
      namedAt.push(i);
      namedOffsets.push(nameOffset[i]);
    }
  }
  writePulsationParams(columns.varType, columns.pulsRho, columns.pulsColorSwing, 0, count);

  return {
    first,
    count,
    columns,
    solIndex,
    namedAt: Uint32Array.from(namedAt),
    namedOffsets: Uint32Array.from(namedOffsets),
  };
}

/** The buffers a window hands over, so a `postMessage` moves them rather
 *  than cloning. Detaches the window — the sender keeps nothing. */
export function catalogWindowTransfers(window: CatalogWindow): ArrayBuffer[] {
  return [window.namedAt, window.namedOffsets, ...Object.values(window.columns)]
    .map((array) => array.buffer as ArrayBuffer);
}
