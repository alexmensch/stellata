// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the record-parity additions ledger (/docs/catalog-driver.md#61-record-parity) and the binding review queue, plus the label
// merge's review queue. See README.md.

import { emitArtifacts } from '../../util/emit-artifacts';
import { stepInputHashes } from '../../util/step-input-hashes';
import { artifactRows, readArtifact } from '../../util/sources/source';
import { MEMBERSHIP_OUTPUTS } from './membership-manifest-outputs';
import { identityText } from '../lineage/identity/identity-pure';
import { KEY_CHANGE_KINDS } from '../lineage/lineage-diff-pure';
import { readIdentity, streamLineageRows } from '../lineage/lineage-io';
import type { LineageRow } from '../lineage/lineage-row-pure';
import { existsSync } from 'node:fs';
import { LINEAGE_LAYOUT } from '../lineage/lineage-layout-pure';
import { stageLines, stageLineageText } from '../lineage/lineage-row-pure';
import { countedStageLineage } from '../lineage/stage-lineage';
import { derivedStage, nestByStage } from '../../util/counts/count-stages-pure';
import { MEMBERSHIP_COUNTS } from './membership-manifest-expected-json';
import {
  MEMBERSHIP_CODES, MEMBERSHIP_INVARIANTS, MEMBERSHIP_LINEAGE_BUDGET, identityLookup, membershipSummary,
  componentsOfBindingLineage, multiplesComponentJoin,
} from './membership-lineage-pure';
import { countSnapshotCheck } from '../../util/snapshot-check';
import { loadBindingEvidence, loadHipVMag } from './binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { gaiaHas5pSolution } from '../distance/gaia-distrust';
import { CLASSIC_ID_OVERLAY, overlayMap } from '../classic-ids/classic-id-overlay-tsv';
import { CLASSIC_ID_OVERRIDES } from '../classic-ids/label-merge/classic-id-overrides-source';
import {
  LABEL_FLIPS,
} from '../classic-ids/label-merge/label-flips-tsv';
import { readMagnitudeTerm } from './magnitude-term/magnitude-term';
import { MAGNITUDE_FLOOR_V, magnitudeTermBlock, magnitudeTermSummary } from './magnitude-term/magnitude-term-pure';
import { INHERITED_SPINE } from '../spine/inherited-spine-tsv';
import { ORIGIN_KEYS } from './origin-keys';
import { loadPrimaryTables } from '../spine/primaries-tables';
import {
  MEMBERSHIP_COUNT_STAGES,
  buildMembership,
} from './membership-manifest-pure';
import { ADDITIONS_LEDGER } from './additions-ledger-tsv';
import { BINDING_REVIEW } from './binding-review-tsv';
import { LABEL_DROPS } from './label-drops-tsv';
import { MERGE_DIVERGENCE } from './merge-divergence-tsv';
import { PAIR_REVIEW } from './pair-review-tsv';
import { MEMBERSHIP_MANIFEST } from './membership-manifest-tsv';
import { BINDING_REVIEW_DISPOSITIONS } from './binding-review-dispositions-source';
import { SPINE_CORRECTIONS } from './spine-corrections/spine-corrections-source';
import { SIMBAD_TYC_HD } from '../simbad/simbad-tyc-hd-source';
import { PAIR_REVIEW_DISPOSITIONS } from './pair-review-dispositions-source';
import { stageFile, BINDING_LINEAGE, MEMBERSHIP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { sourcesWithSiblingComponent } from './binding/binding-gate-pure';
import { SIBLING_RENDERED } from './sibling-rendered-source';

/** The baseline's own binaries stage, never multiples.tsv: a step read would close build:binaries → build:membership. */
function baselineBindingRows(baselineDir: string): Iterable<LineageRow> {
  const file = stageFile(baselineDir, BINDING_LINEAGE.stage);
  return existsSync(file) ? streamLineageRows(file) : [];
}


export async function main(): Promise<void> {
  const spine = readArtifact(INHERITED_SPINE);
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const { evidence, gaiaAstrometry, wdsXids } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), tables.tycho2, tables.gliese),
  );
  const magnitudeTerm = MAGNITUDE_FLOOR_V === null ? null : await readMagnitudeTerm(MAGNITUDE_FLOOR_V);
  const result = buildMembership({
    spine,
    tables,
    overlay: overlayMap(artifactRows(CLASSIC_ID_OVERLAY)),
    overrides: CLASSIC_ID_OVERRIDES.read(),
    siblingRenderedSourceIds: new Set([...sourcesWithSiblingComponent(wdsXids), ...SIBLING_RENDERED.read().map((r) => r.sourceId)]),
    evidence,
    dispositions: BINDING_REVIEW_DISPOSITIONS.read(),
    corrections: SPINE_CORRECTIONS.read(),
    simbadTycHd: SIMBAD_TYC_HD.read(),
    pairDispositions: PAIR_REVIEW_DISPOSITIONS.read(),
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
    lines: () => stageLines(MEMBERSHIP_CODES, result.lineage),
    render: (sorted) => ({
      membership: stageLineageText(MEMBERSHIP_CODES, sorted),
      identity: identityText(result.identity),
    }),
    joins: (baselineDir) => [multiplesComponentJoin(
      identityLookup(result.identity, () => readIdentity(stageFile(baselineDir, MEMBERSHIP_LINEAGE.identity!))),
      componentsOfBindingLineage(baselineBindingRows(baselineDir)),
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
      mergeDivergence: MERGE_DIVERGENCE.serialize(result.mergeDivergence),
      pairReview: PAIR_REVIEW.serialize(result.pairReview),
      ...lineage.files,
    },
    members: lineage.members,
    checks: [...lineage.checks, countSnapshotCheck(MEMBERSHIP_COUNTS, {
      actual: nestByStage(MEMBERSHIP_COUNT_STAGES, [
        { stage: 'magnitude-term', block: magnitudeBlock },
        { stage: 'membership', block: { kind: 'counted', counts: lineage.counts } },
        { stage: derivedStage('membership'), block: { kind: 'counted', counts: result.derived } },
      ]),
      failureLabel: 'membership-manifest count',
    })],
  });
  for (const f of Object.values(MEMBERSHIP_OUTPUTS.files)) console.log(`wrote ${f}`);
}

