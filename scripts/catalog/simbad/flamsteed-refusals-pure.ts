// The frozen list of SIMBAD numbers the Flamsteed rule refuses on a catalogue star: its rows, codec and the comparison its test runs. See README.md#the-refused-numbers.

import { compareCodeUnits } from '../../../src/astro-core/order-pure';
import type { Declared } from '../../util/sources/source';
import { tsvLine, tsvText } from '../../util/tsv/artifact-pure';
import { readTable } from '../../util/tsv/table-pure';
import { FLAMSTEED_REFUSALS, designationText, type FlamsteedRefusalReason, type SimbadFlamsteed } from './simbad-flamsteed-pure';

export const FLAMSTEED_REFUSAL_COLUMNS = ['simbad_oid', 'hip', 'hd', 'designation', 'reason', 'evidence'] as const;

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

/** Each refused number on an object whose HIP or HD names a catalogue record, in oid then designation order. */
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
    }))
    .sort((a, b) => a.simbadOid - b.simbadOid || compareCodeUnits(a.designation, b.designation));
}

export function formatRefusals(file: string, rows: readonly FlamsteedRefusalRow[]): string {
  return tsvText(FLAMSTEED_REFUSAL_COLUMNS, rows.map((r) => tsvLine(file, FLAMSTEED_REFUSAL_COLUMNS, [String(r.simbadOid), r.hip, r.hd, r.designation, r.reason, r.evidence])));
}

const isReason = (value: string): value is FlamsteedRefusalReason => (FLAMSTEED_REFUSALS as readonly string[]).includes(value);

export function parseRefusals(text: string, from: Declared): FlamsteedRefusalRow[] {
  return [...readTable({ ...from, columns: FLAMSTEED_REFUSAL_COLUMNS, exact: true }, text)].map((row) => {
    const reason = row.raw('reason');
    if (!isReason(reason)) row.fail(`reason ${JSON.stringify(reason)} is not one of ${FLAMSTEED_REFUSALS.join(' | ')}`);
    return {
      simbadOid: row.requiredId('simbad_oid'),
      hip: row.raw('hip'),
      hd: row.raw('hd'),
      designation: row.raw('designation'),
      reason: reason as FlamsteedRefusalReason,
      evidence: row.raw('evidence'),
    };
  });
}
