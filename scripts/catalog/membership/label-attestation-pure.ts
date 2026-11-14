// Which classical labels a manifest row keeps, and the routes column naming the primary that attests each. See README.md#the-unattested-labels-leave-the-row.

import {
  CLASSICAL_CELLS,
  attestHd,
  attestSpineRow,
  type PrimaryIndex,
  type PrimaryTables,
  type RowAttestation,
} from '../spine/primaries-audit-pure';
import type { LabelDropReason } from './ledger-rows-pure';
import type { KeyedOutcome } from './membership-lineage-pure';
import { MEMBERSHIP_MANIFEST, joinManifestValues, type ManifestRecord } from './membership-manifest-tsv';

export interface LabelDrop {
  cell: 'hd' | 'flam';
  value: string;
  reason: LabelDropReason;
}

function attestRecord(row: ManifestRecord, tables: PrimaryTables, idx: PrimaryIndex): RowAttestation {
  return attestSpineRow(MEMBERSHIP_MANIFEST.encode(row), tables, idx);
}

/** The spine-label cells a row keeps once those no primary attests leave it —
 *  the Flamsteed number, and the HD number with its aliases — each drop a
 *  label-parity ledger row (/docs/catalog-driver.md#62-label-parity), and the
 *  kept row's attestation, which `attestedRow` needs. The HD drop runs first
 *  because IV/27A can publish a Flamsteed number against an HD no HD primary
 *  attests. */
export function attestedLabels(row: ManifestRecord, tables: PrimaryTables, idx: PrimaryIndex): {
  kept: Pick<ManifestRecord, 'hd' | 'hdAlt' | 'flam'>;
  drops: LabelDrop[];
  attestation: RowAttestation;
} {
  const drops: LabelDrop[] = [];
  const hds = row.hd === null ? row.hdAlt : [row.hd, ...row.hdAlt];
  const attestedHds = hds.filter((hd) => {
    if (attestHd(hd, idx, tables) !== null) return true;
    drops.push({ cell: 'hd', value: String(hd), reason: 'hd_unattested' });
    return false;
  });
  const hdKept = { hd: attestedHds[0] ?? null, hdAlt: attestedHds.slice(1), flam: row.flam };
  const attestation = attestRecord({ ...row, ...hdKept }, tables, idx);
  if (row.flam === null || attestation.attestation.flam !== null) return { kept: hdKept, drops, attestation };
  drops.push({ cell: 'flam', value: String(row.flam), reason: 'flamsteed_unattested' });
  const kept = { ...hdKept, flam: null };
  return { kept, drops, attestation: attestRecord({ ...row, ...kept }, tables, idx) };
}

/** Throws on an unattested `hd` or `flam` cell: run `attestedLabels` first. */
export function attestedRow(
  row: ManifestRecord, tables: PrimaryTables, idx: PrimaryIndex, attestation?: RowAttestation,
): { row: ManifestRecord; outcomes: KeyedOutcome[] } {
  const a = attestation ?? attestRecord(row, tables, idx);
  const routes: string[] = [];
  for (const cell of CLASSICAL_CELLS) {
    const by = a.attestation[cell];
    if (by !== null) routes.push(`${cell}:${by}`);
  }
  if (a.attestation.tyc !== null) routes.push('tyc:tycho2');
  const routed = { ...row, routes: joinManifestValues(routes) };
  const cells = MEMBERSHIP_MANIFEST.encode(routed);
  const key = routed.originKey;
  const outcomes = a.unattested.map((cell): KeyedOutcome => {
    if (cell === 'hd' || cell === 'flam') {
      throw new Error(`manifest row ${key} ships an unattested ${cell} cell (${cells[cell]}); attestedLabels drops it on spine rows and additions take it from the primaries`);
    }
    return { key, outcome: { kind: 'unattested', cell, value: cells[cell] } };
  });
  return { row: routed, outcomes };
}
