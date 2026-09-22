// Test-only catalog.bin builder. See ./README.md, the file roster.

import {
  APSIS_FIELDS,
  HEADER_SIZE,
  NAME_LENGTH_PREFIX_BYTES,
  NAME_TABLE_PADDING,
  NO_APSIS,
  NO_COMPANION,
  RECORD_SIZE,
  writeCatalogHeader,
  writeStarRecord,
  type ApsisField,
  type WireStarRecord,
} from '../../../scripts/catalog/record/catalog-pure';

export type StarRecord = Omit<WireStarRecord, 'apsis'> & { apsis: Record<ApsisField, number> };

export function nanApsis(): Record<ApsisField, number> {
  const out = {} as Record<ApsisField, number>;
  for (const name of APSIS_FIELDS) out[name] = NO_APSIS;
  return out;
}

export const baseStar: StarRecord = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  absmag: 0,
  ci: 0,
  physRadius: 1,
  companionIdx: NO_COMPANION,
  nameOffset: 0,
  spectClass: 0,
  lumClass: 255,
  conIndex: 0,
  flags: 0,
  ampUnits: 0,
  periodUnits: 0,
  varType: 0,
  hip: 0,
  gaiaSourceId: 0n,
  apsis: nanApsis(),
  sid: 0,
  multiplicityStatus: 0,
};

export function nameTableOffsets(names: string[]): number[] {
  const enc = new TextEncoder();
  const offsets: number[] = [];
  let p = NAME_TABLE_PADDING;
  for (const n of names) {
    offsets.push(p);
    p += NAME_LENGTH_PREFIX_BYTES + enc.encode(n).length;
  }
  return offsets;
}

export function buildCatalog(
  records: StarRecord[],
  names: { offset: number; name: string }[] = [],
): ArrayBuffer {
  const enc = new TextEncoder();
  const encodedNames = names.map((n) => ({ ...n, bytes: enc.encode(n.name) }));
  let tableLength = NAME_TABLE_PADDING;
  for (const n of encodedNames) tableLength += NAME_LENGTH_PREFIX_BYTES + n.bytes.length;
  if (encodedNames.length === 0) tableLength = 0;

  const recordsBase = HEADER_SIZE + tableLength;
  const ab = new ArrayBuffer(recordsBase + records.length * RECORD_SIZE);
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);

  writeCatalogHeader(dv, {
    count: records.length,
    nameTableOffset: HEADER_SIZE,
    nameTableLength: tableLength,
  });

  let p = HEADER_SIZE + NAME_TABLE_PADDING;
  for (const n of encodedNames) {
    dv.setUint16(p, n.bytes.length, true);
    u8.set(n.bytes, p + NAME_LENGTH_PREFIX_BYTES);
    p += NAME_LENGTH_PREFIX_BYTES + n.bytes.length;
  }

  records.forEach((r, i) => writeStarRecord(dv, recordsBase + i * RECORD_SIZE, r));
  return ab;
}
