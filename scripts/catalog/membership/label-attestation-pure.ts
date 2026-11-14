// Which classical labels a manifest row keeps, and the routes column naming the primary that attests each. See README.md#the-unattested-labels-leave-the-row.

import {
  CLASSICAL_CELLS,
  attestHd,
  attestSpineRow,
  type PrimaryIndex,
  type PrimaryTables,
  type RowAttestation,
} from '../spine/primaries-audit-pure';
import type { LabelDropCell, LabelDropReason } from './ledger-rows-pure';
import type { KeyedOutcome } from './membership-lineage-pure';
import { MEMBERSHIP_MANIFEST, joinManifestValues, type ManifestRecord } from './membership-manifest-tsv';

export interface LabelDrop {
  cell: LabelDropCell;
  value: string;
  reason: LabelDropReason;
}

/** A row and the attestation taken of that row. */
export interface AttestedRow {
  row: ManifestRecord;
  attestation: RowAttestation;
}

export function attestRow(row: ManifestRecord, tables: PrimaryTables, idx: PrimaryIndex): AttestedRow {
  return { row, attestation: attestSpineRow(MEMBERSHIP_MANIFEST.encode(row), tables, idx) };
}

/** The spine-label cells a row keeps once those no primary attests leave it —
 *  the Flamsteed number, and the HD number with its aliases — each drop a
 *  label-parity ledger row (/docs/catalog-driver.md#62-label-parity). The HD
 *  drop runs first because IV/27A can publish a Flamsteed number against an
 *  HD no HD primary attests. */
export function attestedLabels(
  row: ManifestRecord, tables: PrimaryTables, idx: PrimaryIndex,
): AttestedRow & { drops: LabelDrop[] } {
  const drops: LabelDrop[] = [];
  const hds = row.hd === null ? row.hdAlt : [row.hd, ...row.hdAlt];
  const attestedHds = hds.filter((hd) => {
    if (attestHd(hd, idx, tables) !== null) return true;
    drops.push({ cell: 'hd', value: String(hd), reason: 'hd_unattested' });
    return false;
  });
  const hdKept = attestRow({ ...row, hd: attestedHds[0] ?? null, hdAlt: attestedHds.slice(1) }, tables, idx);
  if (row.flam === null || hdKept.attestation.attestation.flam !== null) return { ...hdKept, drops };
  drops.push({ cell: 'flam', value: String(row.flam), reason: 'flamsteed_unattested' });
  return { ...attestRow({ ...hdKept.row, flam: null }, tables, idx), drops };
}

/** The row with its routes column, and an `unattested` outcome per cell no
 *  primary attests. Throws on an unattested `hd` or `flam` cell: run
 *  `attestedLabels` first. */
export function routedRow({ row, attestation: a }: AttestedRow): { row: ManifestRecord; outcomes: KeyedOutcome[] } {
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
