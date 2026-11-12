// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the record-parity additions ledger (/docs/catalog-driver.md#61-record-parity) and the binding review queue, plus the label
// merge's review queue. See README.md.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../../util/paths';
import { emitArtifacts } from '../../util/emit-artifacts';
import { watchHeap } from '../../util/heap-budget/heap-budget';
import { stepInputHashes } from '../../util/step-input-hashes';
import { artifactRows, readArtifact } from '../../util/sources/source';
import { MEMBERSHIP_OUTPUTS } from './membership-manifest-outputs';
import { identityText } from '../lineage/identity-pure';
import { KEY_CHANGE_KINDS } from '../lineage/lineage-diff-pure';
import { readIdentity } from '../lineage/lineage-io';
import { LINEAGE_LAYOUT } from '../lineage/lineage-layout-pure';
import { stageLineageLine, stageLineageText } from '../lineage/lineage-row-pure';
import { countedStageLineage } from '../lineage/stage-lineage';
import { derivedStage, nestByStage, type StagedCounts } from '../../util/counts/count-stages-pure';
import {
  MEMBERSHIP_CODES, MEMBERSHIP_INVARIANTS, MEMBERSHIP_LINEAGE_BUDGET, identityLookup, membershipSummary,
  multiplesComponentJoin,
} from './membership-lineage-pure';
import { snapshotCheck } from '../../util/snapshot-check';
import { compareCountSnapshot } from '../build-counts';
import { loadBindingEvidence, loadHipVMag } from './binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { gaiaHas5pSolution } from '../distance/gaia-distrust';
import { CLASSIC_ID_OVERLAY, overlayMap } from '../classic-ids/classic-id-overlay-tsv';
import { CLASSIC_ID_OVERRIDES } from '../classic-ids/label-merge/classic-id-overrides-source';
import {
  LABEL_FLIPS,
} from '../classic-ids/label-merge/label-flips-tsv';
import {
  readMultiplesTsv,
  sourceIdsWithSiblingComponent,
} from '../companions/companion-promotion';
import { readMagnitudeTerm } from './magnitude-term/magnitude-term';
import { MAGNITUDE_FLOOR_V, magnitudeTermBlock, magnitudeTermSummary } from './magnitude-term/magnitude-term-pure';
import { INHERITED_SPINE } from '../spine/inherited-spine-tsv';
import { ORIGIN_KEYS } from './origin-keys';
import { loadPrimaryTables } from '../spine/primaries-tables';
import {
  MEMBERSHIP_COUNT_STAGES,
  MEMBERSHIP_EXPECTED_FILE,
  buildMembership,
} from './membership-manifest-pure';
import { ADDITIONS_LEDGER } from './additions-ledger-tsv';
import { BINDING_REVIEW } from './binding-review-tsv';
import { LABEL_DROPS } from './label-drops-tsv';
import { MEMBERSHIP_MANIFEST } from './membership-manifest-tsv';
import { BINDING_REVIEW_DISPOSITIONS } from './binding-review-dispositions-source';
import { SPINE_CORRECTIONS } from './spine-corrections/spine-corrections-source';
import { stageFile, MEMBERSHIP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';


export async function main(): Promise<void> {
  const heap = watchHeap('build:membership');
  const spine = readArtifact(INHERITED_SPINE);
  const multiples = readMultiplesTsv();
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const { evidence, gaiaAstrometry } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), tables.tycho2, tables.gliese),
  );
  const magnitudeTerm = MAGNITUDE_FLOOR_V === null ? null : await readMagnitudeTerm(MAGNITUDE_FLOOR_V);
  const result = buildMembership({
    spine,
    tables,
    overlay: overlayMap(artifactRows(CLASSIC_ID_OVERLAY)),
    overrides: CLASSIC_ID_OVERRIDES.read(),
    siblingRenderedSourceIds: sourceIdsWithSiblingComponent(multiples),
    evidence,
    dispositions: BINDING_REVIEW_DISPOSITIONS.read(),
    corrections: SPINE_CORRECTIONS.read(),
    magnitudeTerm,
    publishesGaiaParallax: (sourceId) => {
      const row = gaiaAstrometry.get(sourceId);
      return row !== undefined && gaiaHas5pSolution(row);
    },
    keys: ORIGIN_KEYS,
  });

  const magnitudeBlock = magnitudeTermBlock(magnitudeTerm);
  console.log(magnitudeTermSummary(magnitudeBlock));

  const lineage = countedStageLineage({
    layout: LINEAGE_LAYOUT,
    spec: MEMBERSHIP_LINEAGE,
    inputs: stepInputHashes(),
    diffed: 'membership',
    lines: () => result.lineage.map((row) => stageLineageLine(MEMBERSHIP_CODES, row)),
    render: (sorted) => ({
      membership: stageLineageText(MEMBERSHIP_CODES, sorted),
      identity: identityText(result.identity),
    }),
    joins: (baselineDir) => [multiplesComponentJoin(
      identityLookup(result.identity, () => readIdentity(stageFile(baselineDir, MEMBERSHIP_LINEAGE.identity!))),
      multiples,
    )],
    budget: MEMBERSHIP_LINEAGE_BUDGET,
    invariants: MEMBERSHIP_INVARIANTS,
    argv: process.argv.slice(2),
  }, MEMBERSHIP_CODES);
  console.log(membershipSummary(lineage.counts, result.derived));
  if (lineage.changes !== null) {
    const tally = lineage.changes;
    console.log(`lineage diff: ${KEY_CHANGE_KINDS.map((k) => `${tally[k]} ${k}`).join(', ')} keys`);
  }

  emitArtifacts({
    outputs: MEMBERSHIP_OUTPUTS,
    files: {
      labelFlips: LABEL_FLIPS.serialize(result.flips),
      manifest: MEMBERSHIP_MANIFEST.serialize(result.rows),
      additions: ADDITIONS_LEDGER.serialize(result.ledger),
      bindingReview: BINDING_REVIEW.serialize(result.bindingReview),
      labelDrops: LABEL_DROPS.serialize(result.labelDrops),
      ...lineage.files,
    },
    members: lineage.members,
    checks: [...lineage.checks, heap.check(), snapshotCheck<StagedCounts>({
      snapshotPath: resolve(ROOT, MEMBERSHIP_EXPECTED_FILE),
      actual: nestByStage({}, { order: MEMBERSHIP_COUNT_STAGES, of: {} }, [
        { stage: 'magnitude-term', block: magnitudeBlock },
        { stage: 'membership', block: { kind: 'counted', counts: lineage.counts } },
        { stage: derivedStage('membership'), block: { kind: 'counted', counts: result.derived } },
      ]),
      compare: compareCountSnapshot,
      failureLabel: 'membership-manifest count',
      script: 'build:membership',
    })],
  });
  for (const f of Object.values(MEMBERSHIP_OUTPUTS.files)) console.log(`wrote ${f}`);
}

