// The sorted, SID-allocated records to the assembled catalog.bin buffer. See README.md.

import {
  APSIS_FIELDS,
  HEADER_SIZE,
  NO_APSIS,
  NO_COMPANION,
  NO_CONSTELLATION_INDEX,
  NO_GAIA_SOURCE_ID,
  RECORD_SIZE,
  SOL_RECORD_INDEX,
  encodeNameTable,
  writeCatalogHeader,
  writeStarRecord,
  type ApsisField,
  type ApsisRow,
} from '../../../src/catalog-format/record/catalog-pure';
import { encodeSpectralBytes } from '../../../src/catalog-format/spectral/spectral-record-bytes';
import type { Star } from '../parse/stars-parse';
import { variabilityUnits } from './records-stage-pure';

export interface CatalogEncodeInputs {
  readonly stars: readonly Star[];
  readonly apsisMap: ReadonlyMap<string, ApsisRow>;
  /** Per record, in `stars` order. */
  readonly sids: readonly number[];
  /** Per record, in `stars` order. */
  readonly multiplicityStatus: Uint8Array;
}

export interface EncodedCatalog {
  readonly buffer: ArrayBuffer;
  /** Header plus name table: where record 0 starts. */
  readonly recordsOffset: number;
  readonly nameTableEntries: number;
}

export function encodeCatalog({ stars, apsisMap, sids, multiplicityStatus }: CatalogEncodeInputs): EncodedCatalog {
  const nameTable = encodeNameTable(stars.map((s) => s.proper));
  const recordsOffset = HEADER_SIZE + nameTable.bytes.length;
  const totalLength = recordsOffset + stars.length * RECORD_SIZE;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  writeCatalogHeader(view, { count: stars.length, nameTableOffset: HEADER_SIZE, nameTableLength: nameTable.bytes.length });
  new Uint8Array(buffer).set(nameTable.bytes, HEADER_SIZE);

  const unclassifiedCon: number[] = [];
  let off = recordsOffset;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const apsisRow = s.gaiaSourceId !== null ? apsisMap.get(s.gaiaSourceId) : undefined;
    const apsis = {} as Record<ApsisField, number>;
    for (const name of APSIS_FIELDS) apsis[name] = apsisRow?.[name] ?? NO_APSIS;

    writeStarRecord(view, off, {
      x: s.x, y: s.y, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz,
      absmag: s.absmag,
      ci: s.ci,
      physRadius: s.physicalRadius,
      companionIdx: s.companionIdx >= 0 ? s.companionIdx : NO_COMPANION,
      nameOffset: s.proper ? nameTable.offsets[i] : 0,
      ...encodeSpectralBytes(s.spectral),
      conIndex: s.conIndex,
      flags: s.flags,
      ...variabilityUnits(s),
      varType: s.varType ?? 0,
      hip: s.hip ?? 0,
      // Gaia DR3 source_ids exceed Number.MAX_SAFE_INTEGER: BigInt off the string, never through a number.
      gaiaSourceId: s.gaiaSourceId !== null ? BigInt(s.gaiaSourceId) : NO_GAIA_SOURCE_ID,
      apsis,
      sid: sids[i],
      multiplicityStatus: multiplicityStatus[i],
    });

    if (s.conIndex === NO_CONSTELLATION_INDEX) unclassifiedCon.push(i);
    off += RECORD_SIZE;
  }

  // The IAU boundaries partition the sphere, so only Sol, at the origin, has no direction to classify; any
  // other holder means an assignment path was skipped, which downstream shows as a blank row, not an error.
  if (unclassifiedCon.length !== 1 || unclassifiedCon[0] !== SOL_RECORD_INDEX) {
    throw new Error(
      `Expected Sol (record ${SOL_RECORD_INDEX}) to be the only record without a `
      + `constellation; got ${unclassifiedCon.length}: `
      + `${unclassifiedCon.slice(0, 10).join(', ')}`,
    );
  }
  if (off !== totalLength) {
    throw new Error(`Size mismatch: wrote ${off}, expected ${totalLength}`);
  }

  return { buffer, recordsOffset, nameTableEntries: nameTable.entries };
}
