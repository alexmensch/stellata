// Emit data/classic-ids/classic_id_overlay.tsv — the source_id-keyed classic
// designation overlay — with its lineage and the two gate queues it views. See README.md.
import { resolve } from 'node:path';

import { loadClassicIdCrossWalks } from './binding-candidates';
import { loadBindingEvidence, loadHipVMag } from '../membership/binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { GLIESE } from '../gliese-source';
import { TYCHO2 } from '../tycho2-source';
import {
  buildClassicIdOverlay,
  type ClassicIdOverlay,
  type OverlayJoinCounts,
} from './classic-id-overlay-pure';
import {
  CLASSIC_ID_CODES, CLASSIC_ID_LINEAGE_BUDGET, classicIdLineage, rejectedBindingsView, routeDisagreementsView,
} from './classic-id-lineage-pure';
import { CLASSIC_ID_KEYS } from './classic-id-keys';
import { REJECTED_BINDINGS } from './rejected-bindings-tsv';
import { ROUTE_DISAGREEMENTS } from './route-disagreements-tsv';
import { CLASSIC_ID_OVERLAY, overlayRows } from './classic-id-overlay-tsv';
import { REPO_ROOT as ROOT } from '../../util/paths';
import { emitArtifacts } from '../../util/emit-artifacts';
import { stepInputHashes } from '../../util/step-input-hashes';
import { CLASSIC_ID_OUTPUTS } from './classic-id-overlay-outputs';
import { countSnapshotCheck } from '../../util/snapshot-check';
import { LINEAGE_LAYOUT } from '../lineage/lineage-layout-pure';
import { stageLineageLine, stageLineageText } from '../lineage/lineage-row-pure';
import { stageLineage } from '../lineage/stage-lineage';
import { CLASSIC_IDS_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

const {
  overlay: OUT_OVERLAY, disagreements: OUT_DISAGREEMENTS, rejected: OUT_REJECTED,
} = CLASSIC_ID_OUTPUTS.files;
const EXPECTED_COUNTS = resolve(
  ROOT,
  'scripts/catalog/classic-ids/classic-id-overlay-expected.json',
);

function logOverlay(overlay: ClassicIdOverlay, counts: OverlayJoinCounts): void {
  console.log(
    `overlay: ${overlay.size} source_ids — hd ${counts.overlayHd}, ` +
      `hip ${counts.overlayHip}, hr ${counts.overlayHr}, gj ${counts.overlayGj}, ` +
      `bayer ${counts.overlayBayer}, flamsteed ${counts.overlayFlamsteed}`,
  );
  console.log(
    `HD→TYC route: ${counts.tycResolvedToSource} / ${counts.tyc2HdDistinctTyc} ` +
      `IV/25 Tycho ids resolve (${counts.tycUnresolved} absent from the ` +
      `best-neighbour walk); HIP-route cross-check ${counts.hdHipRouteAgree} agree, ` +
      `${counts.hdHipRouteDisagree} disagree, ${counts.hdHipRouteHipOnly} HIP-only`,
  );
  console.log(
    `binding gate: dropped ${counts.gateRejectedMag} rows on G−V, ` +
      `${counts.gateRejectedSibling} on sibling-letter attribution; ` +
      `${counts.gateSkippedNoPrintedV} rows carry no printed V under any tier ` +
      `and bind on the sibling arm alone (gateable via printed_hip ${counts.gateableVia.printed_hip}, ` +
      `tycho2 ${counts.gateableVia.tycho2}, gliese ${counts.gateableVia.gliese}); ` +
      `${counts.gateSkippedNoGMag} gateable rows are absent ` +
      `from the astrometry pull (must be 0 — the request under-covers the ` +
      `candidates), ${counts.gateSkippedNullGMag} have a row but no published G`,
  );
}

export async function main(): Promise<void> {
  const { evidence } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), TYCHO2.read(), GLIESE.read()),
  );
  const join = buildClassicIdOverlay({ ...await loadClassicIdCrossWalks(), evidence });
  const rows = classicIdLineage(join, CLASSIC_ID_KEYS);
  const disagreements = routeDisagreementsView(rows);
  const rejected = rejectedBindingsView(rows);

  logOverlay(join.overlay, join.counts);
  const lineage = stageLineage({
    layout: LINEAGE_LAYOUT,
    spec: CLASSIC_IDS_LINEAGE,
    inputs: stepInputHashes(),
    diffed: 'classic-ids',
    lines: () => rows.map((row) => stageLineageLine(CLASSIC_ID_CODES, row)),
    render: (sorted) => ({ 'classic-ids': stageLineageText(CLASSIC_ID_CODES, sorted) }),
    joins: () => [],
    budget: CLASSIC_ID_LINEAGE_BUDGET,
    invariants: [],
    argv: process.argv.slice(2),
  });
  emitArtifacts({
    outputs: CLASSIC_ID_OUTPUTS,
    files: {
      overlay: CLASSIC_ID_OVERLAY.serialize(overlayRows(join.overlay)),
      disagreements: ROUTE_DISAGREEMENTS.serialize(disagreements),
      rejected: REJECTED_BINDINGS.serialize(rejected),
      ...lineage.files,
    },
    members: lineage.members,
    checks: [...lineage.checks, countSnapshotCheck<OverlayJoinCounts>({
      snapshotPath: EXPECTED_COUNTS,
      actual: join.counts,
      failureLabel: 'classic-id-overlay count',
      script: 'build:classic-ids',
    })],
  });
  console.log(`wrote ${OUT_OVERLAY}`);
  console.log(`wrote ${OUT_DISAGREEMENTS} (${disagreements.length} rows)`);
  console.log(`wrote ${OUT_REJECTED} (${rejected.length} rows)`);
}
