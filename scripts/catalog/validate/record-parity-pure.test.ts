import { describe, it, expect } from 'vitest';
import {
  APSIS_FIELDS,
  HEADER_SIZE,
  MULTIPLICITY_SINGLE,
  NO_APSIS,
  NO_COMPANION,
  RECORD_SIZE,
  writeCatalogHeader,
  writeStarRecord,
  type ApsisField,
} from '../record/catalog-pure';
import { compareRecordParity, parityHolds } from './record-parity-pure';

interface Star {
  sid: number;
  x?: number;
  absmag?: number;
  hip?: number;
  gaiaSourceId?: bigint;
  companionIdx?: number;
}

const NAME_TABLE_LENGTH = 2; // offset 0 is the reserved "no name" sentinel

function buildCatalog(stars: readonly Star[]): ArrayBuffer {
  const recordsAt = HEADER_SIZE + NAME_TABLE_LENGTH;
  const buffer = new ArrayBuffer(recordsAt + stars.length * RECORD_SIZE);
  const view = new DataView(buffer);
  writeCatalogHeader(view, {
    count: stars.length,
    nameTableOffset: HEADER_SIZE,
    nameTableLength: NAME_TABLE_LENGTH,
  });
  const apsis = {} as Record<ApsisField, number>;
  for (const f of APSIS_FIELDS) apsis[f] = NO_APSIS;
  stars.forEach((s, i) => {
    writeStarRecord(view, recordsAt + i * RECORD_SIZE, {
      x: s.x ?? 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0,
      absmag: s.absmag ?? 4, ci: 0.65, physRadius: 1,
      companionIdx: s.companionIdx ?? NO_COMPANION,
      nameOffset: 0, spectClass: 4, lumClass: 2, conIndex: 7, flags: 0,
      ampUnits: 0, periodUnits: 0, varType: 0,
      hip: s.hip ?? 0, gaiaSourceId: s.gaiaSourceId ?? 0n,
      apsis, sid: s.sid, multiplicityStatus: MULTIPLICITY_SINGLE,
    });
  });
  return buffer;
}

describe('record parity — additive mode', () => {
  it('a re-sort that only adds records is parity, indices notwithstanding', () => {
    const baseline = buildCatalog([{ sid: 10, absmag: 1 }, { sid: 20, absmag: 5 }]);
    // Every baseline record moves index; one new record lands between them.
    const current = buildCatalog([
      { sid: 10, absmag: 1 }, { sid: 99, absmag: 3 }, { sid: 20, absmag: 5 },
    ]);

    const report = compareRecordParity(baseline, current);
    expect(parityHolds(report)).toBe(true);
    expect(report.addedSids).toBe(1);
    expect(report.droppedSids).toEqual([]);
  });

  it('names a field that moved on a shared sid', () => {
    const baseline = buildCatalog([{ sid: 10, absmag: 1 }]);
    const current = buildCatalog([{ sid: 10, absmag: 1.5 }]);

    const report = compareRecordParity(baseline, current);
    expect(parityHolds(report)).toBe(false);
    expect(report.deltasByField.get('absmag')).toBe(1);
    expect(report.deltas).toEqual([
      { sid: 10, field: 'absmag', baseline: '1', current: '1.5' },
    ]);
  });

  it('a dropped sid fails even though nothing else moved', () => {
    const baseline = buildCatalog([{ sid: 10 }, { sid: 20 }]);
    const current = buildCatalog([{ sid: 10 }]);

    const report = compareRecordParity(baseline, current);
    expect(report.droppedSids).toEqual([20]);
    expect(parityHolds(report)).toBe(false);
  });

  it('compares the companion as an object, so a re-sort alone is not a delta', () => {
    const baseline = buildCatalog([
      { sid: 10, companionIdx: 1 }, { sid: 20, companionIdx: 0 },
    ]);
    const current = buildCatalog([
      { sid: 99 }, { sid: 10, companionIdx: 2 }, { sid: 20, companionIdx: 1 },
    ]);

    const report = compareRecordParity(baseline, current);
    expect(report.deltasByField.get('companionSid')).toBeUndefined();
  });

  it('a companion pointing at a DIFFERENT object is a delta', () => {
    const baseline = buildCatalog([{ sid: 10, companionIdx: 1 }, { sid: 20 }]);
    const current = buildCatalog([{ sid: 10, companionIdx: 1 }, { sid: 30 }]);

    const report = compareRecordParity(baseline, current);
    expect(report.deltasByField.get('companionSid')).toBe(1);
  });

  it('skips a sid two records share rather than comparing an arbitrary one', () => {
    const baseline = buildCatalog([{ sid: 10, absmag: 1 }]);
    const current = buildCatalog([{ sid: 10, absmag: 1 }, { sid: 10, absmag: 9 }]);

    const report = compareRecordParity(baseline, current);
    expect(report.currentSharedSids).toBe(1);
    expect(report.deltasByField.size).toBe(0);
    expect(report.droppedSids).toEqual([]);
  });

  it('NO_SID records are counted, never keyed', () => {
    const baseline = buildCatalog([{ sid: 10 }]);
    const current = buildCatalog([{ sid: 10 }, { sid: 0 }, { sid: 0 }]);

    const report = compareRecordParity(baseline, current);
    expect(report.currentUnallocated).toBe(2);
    expect(report.addedSids).toBe(0);
    expect(parityHolds(report)).toBe(true);
  });
});
