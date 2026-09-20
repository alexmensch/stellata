// See ./README.md § The catalog-decode worker.

import { describe, expect, it } from 'vitest';
import {
  FLAG_HAS_NAME,
  FLAG_IS_SOL,
  RECORD_SIZE,
  VAR_TYPE_MIRA,
  readCatalogHeader,
  recordsOffset,
} from '../../../scripts/catalog/record/catalog-pure';
import {
  PULSATION_PARAMS_BY_TYPE,
  PULSATION_PARAMS_DEFAULT,
} from '../star-pipeline/pulsation/pulsation-params-pure';
import { baseStar, buildCatalog, nameTableOffsets } from './catalog-fixture';
import {
  CATALOG_WINDOW_COLUMNS,
  allocateCatalogColumns,
  catalogWindowTransfers,
  decodeCatalogWindow,
  recordWindowBytes,
} from './catalog-window';

const NAMES = ['Sirius', 'Vega', 'Betelgeuse', 'Rigel'];
const OFFSETS = nameTableOffsets(NAMES);

// Four records: only #1 and #3 are named, #2 is Sol, #0 partners #3.
const RECORDS = [
  { ...baseStar, x: 1, y: 2, z: 3, companionIdx: 3 },
  { ...baseStar, x: 4, vx: 0.5, flags: FLAG_HAS_NAME, nameOffset: OFFSETS[1], varType: VAR_TYPE_MIRA },
  { ...baseStar, x: 5, flags: FLAG_IS_SOL, hip: 7 },
  { ...baseStar, x: 6, flags: FLAG_HAS_NAME, nameOffset: OFFSETS[3], companionIdx: 0 },
];

const SOURCE = buildCatalog(RECORDS, NAMES.map((name, i) => ({ offset: OFFSETS[i], name })));
const OFFSET = recordsOffset(readCatalogHeader(SOURCE));

function decode(first: number, end: number) {
  const { start, length } = recordWindowBytes(OFFSET, first, end);
  return decodeCatalogWindow(new DataView(SOURCE, start, length), first, end - first);
}

describe('decodeCatalogWindow', () => {
  it('indexes a mid-catalogue window from zero, not from its record index', () => {
    const w = decode(2, 4);
    expect(w.first).toBe(2);
    expect(w.count).toBe(2);
    expect(w.columns.positions.length).toBe(2 * 3);
    expect(w.columns.positions[0]).toBeCloseTo(5, 5);
    expect(w.columns.positions[3]).toBeCloseTo(6, 5);
    expect(w.columns.hip[0]).toBe(7);
  });

  it('resolves the no-companion sentinel to -1 and keeps a real index', () => {
    const w = decode(0, 4);
    expect(w.columns.companion[0]).toBe(3);
    expect(w.columns.companion[1]).toBe(-1);
    expect(w.columns.companion[3]).toBe(0);
  });

  it('reports Sol window-relative, and -1 where the window misses it', () => {
    expect(decode(0, 4).solIndex).toBe(2);
    expect(decode(2, 4).solIndex).toBe(0);
    expect(decode(3, 4).solIndex).toBe(-1);
  });

  it('carries only the named records, window-relative, with their offsets', () => {
    const w = decode(1, 4);
    expect([...w.namedAt]).toEqual([0, 2]);
    expect([...w.namedOffsets]).toEqual([OFFSETS[1], OFFSETS[3]]);
  });

  it('derives the pulsation params off the window\'s own varType', () => {
    const w = decode(1, 3);
    expect(w.columns.pulsRho[0]).toBeCloseTo(PULSATION_PARAMS_BY_TYPE[VAR_TYPE_MIRA].rho, 5);
    expect(w.columns.pulsColorSwing[1]).toBeCloseTo(PULSATION_PARAMS_DEFAULT.colorSwing, 5);
  });

  it('decodes an empty window without reading a record', () => {
    const w = decode(2, 2);
    expect(w.count).toBe(0);
    expect(w.columns.positions.length).toBe(0);
    expect(w.solIndex).toBe(-1);
  });
});

describe('the window column roster', () => {
  it('lists every allocated column exactly once', () => {
    const keys = CATALOG_WINDOW_COLUMNS.map(([key]) => key);
    expect([...keys].sort()).toEqual(Object.keys(allocateCatalogColumns(0)).sort());
  });

  it('gives each column the stride its allocation uses', () => {
    const columns = allocateCatalogColumns(5);
    for (const [key, stride] of CATALOG_WINDOW_COLUMNS) {
      expect(columns[key].length, key).toBe(5 * stride);
    }
  });
});

describe('catalogWindowTransfers', () => {
  it('hands over every column buffer plus the named-record arrays', () => {
    const w = decode(0, 4);
    const buffers = catalogWindowTransfers(w);
    expect(new Set(buffers).size).toBe(CATALOG_WINDOW_COLUMNS.length + 2);
    expect(buffers).toContain(w.columns.positions.buffer);
    expect(buffers).toContain(w.namedOffsets.buffer);
  });
});

describe('recordWindowBytes', () => {
  it('spans exactly the window\'s records', () => {
    expect(recordWindowBytes(OFFSET, 1, 3)).toEqual({
      start: OFFSET + RECORD_SIZE,
      length: 2 * RECORD_SIZE,
    });
  });
});
