import { describe, expect, it } from 'vitest';

import {
  HEADER_SIZE,
  NO_COMPANION,
  NO_CONSTELLATION_INDEX,
  NO_SID,
  RECORD_SIZE,
  readCatalogHeader,
  readNameTable,
  readRecordField,
  readRecordFieldBig,
  recordsOffset,
  type ApsisRow,
} from '../../../src/catalog-format/record/catalog-pure';
import { makeStar } from '../parse/star-fixture';
import { encodeCatalog } from './encode-catalog-pure';

const GAIA_ID = '4472832130942575872';
const APSIS: ApsisRow = {
  teffGspphot: 5800, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
  teffGspspec: null, loggGspspec: 4.5, mhGspspec: null, spectraltypeEsphs: null,
};
const SOL = makeStar({ proper: 'Sol' });
const STAR = makeStar({
  x: 1.5, conIndex: 7, proper: 'Fixture', hip: 42, gaiaSourceId: GAIA_ID, companionIdx: 0,
  periodDays: 10, amplitudeMag: 0.5,
});

const encode = (stars = [SOL, makeStar({ conIndex: 3 }), STAR]) => encodeCatalog({
  stars, apsisMap: new Map([[GAIA_ID, APSIS]]), sids: stars.map((_, i) => 100 + i), multiplicityStatus: Uint8Array.of(0, 1, 2),
});

describe('encodeCatalog', () => {
  it('writes the header, then the name table, then one record per star', () => {
    const { buffer, recordsOffset: offset, nameTableEntries } = encode();
    const header = readCatalogHeader(buffer);
    expect(header.count).toBe(3);
    expect(header.nameTableOffset).toBe(HEADER_SIZE);
    expect(recordsOffset(header)).toBe(offset);
    expect(buffer.byteLength).toBe(offset + 3 * RECORD_SIZE);
    expect(nameTableEntries).toBe(2);
    expect([...readNameTable(buffer, header.nameTableOffset, header.nameTableLength).values()]).toEqual(['Sol', 'Fixture']);
  });

  it('round-trips each record field through the readers', () => {
    const { buffer, recordsOffset: offset } = encode();
    const view = new DataView(buffer);
    const [sol, unnamed, star] = [0, 1, 2].map((i) => offset + i * RECORD_SIZE);
    expect(readRecordField(view, sol, 'conIndex')).toBe(NO_CONSTELLATION_INDEX);
    expect(readRecordField(view, sol, 'companion')).toBe(NO_COMPANION);
    expect(readRecordField(view, unnamed, 'nameOffset')).toBe(0);
    expect(readRecordFieldBig(view, unnamed, 'gaiaSourceId')).toBe(0n);
    expect(Number.isNaN(readRecordField(view, unnamed, 'teffGspphot'))).toBe(true);
    expect(readRecordField(view, star, 'x')).toBe(1.5);
    expect(readRecordField(view, star, 'companion')).toBe(0);
    expect(readRecordField(view, star, 'hip')).toBe(42);
    expect(readRecordFieldBig(view, star, 'gaiaSourceId')).toBe(BigInt(GAIA_ID));
    expect(readRecordField(view, star, 'teffGspphot')).toBe(5800);
    expect(readRecordField(view, star, 'loggGspspec')).toBe(4.5);
    expect(Number.isNaN(readRecordField(view, star, 'mhGspphot'))).toBe(true);
    expect(readRecordField(view, star, 'ampUnits')).toBe(10);
    expect(readRecordField(view, star, 'period')).toBe(100);
    expect(readRecordField(view, star, 'sid')).toBe(102);
    expect(readRecordField(view, star, 'multiplicityStatus')).toBe(2);
  });

  it('throws on a SID or multiplicity status list that does not pair with the records, and on NO_SID', () => {
    const stars = [SOL, STAR];
    const apsisMap = new Map<string, ApsisRow>();
    expect(() => encodeCatalog({ stars, apsisMap, sids: [1], multiplicityStatus: Uint8Array.of(0, 0) }))
      .toThrow(/2 records but 1 SIDs and 2 multiplicity statuses/);
    expect(() => encodeCatalog({ stars, apsisMap, sids: [1, 2], multiplicityStatus: Uint8Array.of(0) }))
      .toThrow(/2 records but 2 SIDs and 1 multiplicity statuses/);
    expect(() => encodeCatalog({ stars, apsisMap, sids: [1, NO_SID], multiplicityStatus: Uint8Array.of(0, 0) }))
      .toThrow(/record 1 carries NO_SID/);
  });

  it('throws unless Sol, at record 0, is the only record without a constellation', () => {
    expect(() => encode([SOL, makeStar(), STAR])).toThrow(/only record without a constellation; got 2: 0, 1/);
    expect(() => encode([STAR, SOL, STAR])).toThrow(/got 1: 1/);
  });
});
