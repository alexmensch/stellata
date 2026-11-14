// The spine side: each kept spine row's labels merged on its settled binding, its unattested labels dropped, one manifest row each. See README.md#the-spine-side.

import { SOL_APPARENT_V_MAGNITUDE } from '../../../src/catalog-format/record/catalog-pure';
import {
  BRIGHT_TIER_MAG_CEILING,
  type ClassicIdOverlay,
} from '../classic-ids/classic-id-overlay-pure';
import {
  mergeClassicIdLabels,
  spineLabelMergeRecord,
  type LabelMergeCounts,
  type LabelMergeRecord,
  type LabelOverrides,
} from '../classic-ids/label-merge/label-merge-pure';
import type { SpineRow } from '../spine/inherited-spine-pure';
import type { PrimaryIndex, PrimaryTables } from '../spine/primaries-audit-pure';
import type { SpineSettlement } from './binding/spine-settle-pure';
import { attestedLabels, attestedRow } from './label-attestation-pure';
import type { KeyedOutcome } from './membership-lineage-pure';
import { primariesManifestRecord, type ManifestRecord } from './membership-manifest-tsv';

export interface SpineSide {
  /** Per kept spine row, in order. */
  rows: ManifestRecord[];
  /** The label merge's records, before the unattested labels leave. */
  records: LabelMergeRecord[];
  mergeCounts: LabelMergeCounts;
  outcomes: KeyedOutcome[];
}

export function spineSide(input: {
  kept: readonly SpineRow[];
  keyOf: (keptRow: number) => string;
  settlement: Pick<SpineSettlement, 'bindings' | 'settled'>;
  overlay: ClassicIdOverlay;
  overrides: LabelOverrides;
  siblingRenderedSourceIds: ReadonlySet<string>;
  tables: PrimaryTables;
  idx: PrimaryIndex;
}): SpineSide {
  const { kept, keyOf, overlay, tables, idx } = input;
  const { bindings, settled } = input.settlement;
  // The merge keys on the DERIVED binding, so the labels a record takes are the
  // ones the overlay hangs on the source it is actually bound to.
  const spineSides = kept.map((row, i) => spineLabelMergeRecord(row, settled[i].value));
  const records = spineSides.map((s) => s.record);
  const merge = mergeClassicIdLabels({
    records,
    labels: spineSides.map((s) => s.label),
    overlay,
    overrides: input.overrides,
    siblingRenderedSourceIds: input.siblingRenderedSourceIds,
  });
  const outcomes: KeyedOutcome[] = [];
  const rows = records.map((record, i) => {
    const key = keyOf(i);
    if (record.gaiaSourceId === null) outcomes.push({ key, outcome: { kind: 'ships-none' } });
    const b = bindings[i];
    const mag = b.outcome === 'sol' ? SOL_APPARENT_V_MAGNITUDE : b.gate.printedV?.vMag ?? null;
    if (mag !== null && mag <= BRIGHT_TIER_MAG_CEILING) {
      const overlayEntry = record.gaiaSourceId !== null && overlay.has(record.gaiaSourceId);
      outcomes.push({ key, outcome: { kind: 'bright', overlayEntry } });
    }
    const merged = primariesManifestRecord(kept[i], record, settled[i].binding, key);
    const labels = attestedLabels(merged, tables, idx);
    for (const d of labels.drops) outcomes.push({ key, outcome: { kind: 'label-drop', ...d } });
    const attested = attestedRow({ ...merged, ...labels.kept }, tables, idx, labels.attestation);
    outcomes.push(...attested.outcomes);
    return attested.row;
  });
  const keyBySource = new Map<string, string>();
  records.forEach((r, i) => {
    if (r.gaiaSourceId !== null) keyBySource.set(r.gaiaSourceId, keyOf(i));
  });
  for (const { sourceId, ...flip } of merge.flips) {
    const key = keyBySource.get(sourceId);
    if (key === undefined) throw new Error(`label merge flipped ${flip.field} on ${sourceId}, which no spine record binds`);
    outcomes.push({ key, outcome: { kind: 'label-flip', flip } });
  }
  return { rows, records, mergeCounts: merge.counts, outcomes };
}
