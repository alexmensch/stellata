// Emit data/classic-ids/classic_id_overlay.tsv — the source_id-keyed classic
// designation overlay. See README.md.
import { resolve } from 'node:path';

import { compareCountSnapshot } from '../build-counts';
import { loadClassicIdCrossWalks } from './binding-candidates';
import { loadBindingEvidence, loadHipVMag } from '../membership/binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { loadGliese, loadTycho2 } from '../spine/primaries-tables';
import {
  buildClassicIdOverlay,
  type OverlayJoinCounts,
} from './classic-id-overlay-pure';
import { REJECTED_BINDINGS } from './rejected-bindings-tsv';
import { ROUTE_DISAGREEMENTS } from './route-disagreements-tsv';
import {
  serializeOverlay,
  type ClassicIdOverlay,
} from './classic-id-overlay-tsv';
import { REPO_ROOT as ROOT } from '../../util/paths';
import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import { CLASSIC_ID_OUTPUTS } from './classic-id-overlay-outputs';
import { snapshotCheck } from '../../util/snapshot-check';

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

async function main(): Promise<void> {
  const { evidence } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), loadTycho2(), loadGliese()),
  );
  const {
    overlay,
    counts: joinCounts,
    disagreements,
    rejectedBindings,
  } = buildClassicIdOverlay({ ...await loadClassicIdCrossWalks(), evidence });

  logOverlay(overlay, joinCounts);
  emitArtifacts({
    outputs: CLASSIC_ID_OUTPUTS,
    files: {
      overlay: serializeOverlay(overlay),
      disagreements: ROUTE_DISAGREEMENTS.serialize(disagreements),
      rejected: REJECTED_BINDINGS.serialize(rejectedBindings.map((r) => ({
        sourceId: r.sourceId, hip: r.hip, vMag: r.printedV?.vMag ?? null, vVia: r.printedV?.vVia ?? null,
        gMag: r.gMag, reason: r.reason, designations: r.designations,
      }))),
    },
    checks: [snapshotCheck<OverlayJoinCounts>({
      envVar: 'UPDATE_BUILD_COUNTS',
      snapshotPath: EXPECTED_COUNTS,
      actual: joinCounts,
      compare: compareCountSnapshot,
      failureLabel: 'classic-id-overlay count',
      refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:classic-ids',
    })],
  });
  console.log(`wrote ${OUT_OVERLAY}`);
  console.log(`wrote ${OUT_DISAGREEMENTS} (${disagreements.length} rows)`);
  console.log(`wrote ${OUT_REJECTED} (${rejectedBindings.length} rows)`);
}

runStep(main);
