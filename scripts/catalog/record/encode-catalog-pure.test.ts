import { describe, expect, it } from 'vitest';

import {
  FLAG_BINARY_PRIMARY,
  FLAG_HAS_BAYER,
  FLAG_HAS_NAME,
  HEADER_SIZE,
  VAR_TYPE_MIRA,
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
import { allocatedSids, enterPhase, finalise, type Finalised } from './record-phase';
import type { Star } from '../parse/stars-parse';

const GAIA_ID = '4472832130942575872';
const APSIS: ApsisRow = {
  teffGspphot: 5800, loggGspphot: null, mhGspphot: null, azeroGspphot: null,
  teffGspspec: null, loggGspspec: 4.5, mhGspspec: null, spectraltypeEsphs: null,
};
const SOL = makeStar();
const STAR = makeStar({
  x: 1.5, y: -2.25, z: 3.75, vx: 0.125, vy: -0.25, vz: 0.375, absmag: 4.5, ci: 0.625, physicalRadius: 2.5,
  spectral: { kind: 'mk', letter: 4, subclass: 2, lumClass: 3 },
  conIndex: 7, bayer: 'α', varType: VAR_TYPE_MIRA,
  hip: 42, gaiaSourceId: GAIA_ID, companionIdx: 0,
  periodDays: 10, amplitudeMag: 0.5,
});

const finalised = (stars: Star[], sids: number[], displayNames: (string | null)[]): Finalised =>
  finalise(enterPhase('sorted', stars), allocatedSids(sids), displayNames);

const encode = (stars = [SOL, makeStar({ conIndex: 3 }), STAR], binaryPrimaries = new Set<number>()) => encodeCatalog({
  catalog: finalised(stars, stars.map((_, i) => 100 + i), ['Sol', null, 'Fixture']),
  apsisMap: new Map([[GAIA_ID, APSIS]]), multiplicityStatus: Uint8Array.of(0, 1, 2), binaryPrimaries,
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
    const floats = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'absmag', 'ci', 'physRadius'] as const;
    expect(floats.map((f) => readRecordField(view, star, f))).toEqual([1.5, -2.25, 3.75, 0.125, -0.25, 0.375, 4.5, 0.625, 2.5]);
    expect(readRecordField(view, star, 'spectClass')).toBe(4);
    expect(readRecordField(view, star, 'lumClass')).toBe(3);
    expect(readRecordField(view, star, 'conIndex')).toBe(7);
    expect(readRecordField(view, star, 'flags')).toBe(FLAG_HAS_NAME | FLAG_HAS_BAYER);
    expect(readRecordField(view, star, 'varType')).toBe(VAR_TYPE_MIRA);
    const header = readCatalogHeader(buffer);
    expect(readNameTable(buffer, header.nameTableOffset, header.nameTableLength).get(readRecordField(view, star, 'nameOffset')))
      .toBe('Fixture');
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

  it('sets FLAG_HAS_NAME from the display name, FLAG_HAS_BAYER from the Bayer letter and FLAG_BINARY_PRIMARY from the claims, beside the record\'s own flags', () => {
    const { buffer, recordsOffset: offset } = encode(undefined, new Set([1, 2]));
    const view = new DataView(buffer);
    expect([0, 1, 2].map((i) => readRecordField(view, offset + i * RECORD_SIZE, 'flags')))
      .toEqual([FLAG_HAS_NAME, FLAG_BINARY_PRIMARY, FLAG_HAS_NAME | FLAG_HAS_BAYER | FLAG_BINARY_PRIMARY]);
  });

  it('throws on a multiplicity status list that does not pair with the records, and on NO_SID', () => {
    const stars = [SOL, STAR];
    const apsisMap = new Map<string, ApsisRow>();
    const displayNames = ['Sol', null];
    const binaryPrimaries = new Set<number>();
    expect(() => encodeCatalog({
      catalog: finalised(stars, [1, 2], displayNames), apsisMap, multiplicityStatus: Uint8Array.of(0), binaryPrimaries,
    })).toThrow(/2 records but 1 multiplicity statuses/);
    expect(() => encodeCatalog({
      catalog: finalised(stars, [1, NO_SID], displayNames), apsisMap, multiplicityStatus: Uint8Array.of(0, 0), binaryPrimaries,
    })).toThrow(/record 1 carries NO_SID/);
  });

  it('throws unless Sol, at record 0, is the only record without a constellation', () => {
    expect(() => encode([SOL, makeStar(), STAR])).toThrow(/only record without a constellation; got 2: 0, 1/);
    expect(() => encode([STAR, SOL, STAR])).toThrow(/got 1: 1/);
  });
});
