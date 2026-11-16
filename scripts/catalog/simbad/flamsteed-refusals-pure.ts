// The SIMBAD numbers the Flamsteed rule refuses on a catalogue star, as ledger rows. See README.md#the-refused-numbers.

import { designationText, type FlamsteedRefusalReason, type SimbadFlamsteed } from './simbad-flamsteed-pure';

export interface FlamsteedRefusalRow {
  readonly simbadOid: number;
  readonly hip: string;
  readonly hd: string;
  readonly designation: string;
  readonly reason: FlamsteedRefusalReason;
  readonly evidence: string;
}

export interface CatalogueKeys {
  readonly hips: ReadonlySet<number>;
  readonly hds: ReadonlySet<number>;
}

/** Each refused number on an object whose HIP or HD names a catalogue record. */
export function refusalRows(index: SimbadFlamsteed, keys: CatalogueKeys): FlamsteedRefusalRow[] {
  return index.refused
    .filter((r) => r.object.hips.some((h) => keys.hips.has(h)) || r.object.hds.some((h) => keys.hds.has(h)))
    .map((r) => ({
      simbadOid: r.object.oid,
      hip: r.object.hips.join('|'),
      hd: r.object.hds.join('|'),
      designation: designationText(r.designation),
      reason: r.reason,
      evidence: r.evidence,
    }));
}
