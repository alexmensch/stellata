// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the record-parity additions ledger (/docs/catalog-driver.md#61-record-parity) and the binding review queue, plus the label
// merge's review queue. See README.md.

import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../../util/paths';
import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import { artifactRows, readArtifact } from '../../util/sources/source';
import { MEMBERSHIP_LINEAGE, MEMBERSHIP_OUTPUTS } from './membership-manifest-outputs';
import { identityText } from '../lineage/identity-pure';
import { LINEAGE_LAYOUT, readIdentity, stageFile } from '../lineage/lineage-io';
import { stageLineageText } from '../lineage/lineage-row-pure';
import { stageLineage } from '../lineage/stage-lineage';
import {
  MEMBERSHIP_CODES, MEMBERSHIP_LINEAGE_BUDGET, multiplesComponentJoin,
} from './membership-lineage-pure';
import { snapshotCheck } from '../../util/snapshot-check';
import { compareCountSnapshot } from '../build-counts';
import { loadBindingEvidence, loadHipVMag } from './binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { gaiaHas5pSolution } from '../distance/gaia-distrust';
import {
  BRIGHT_TIER_MAG_CEILING,
} from '../classic-ids/classic-id-overlay-pure';
import { CLASSIC_ID_OVERLAY, overlayMap } from '../classic-ids/classic-id-overlay-tsv';
import { LABEL_FIELDS } from '../classic-ids/label-merge/label-merge-pure';
import { CLASSIC_ID_OVERRIDES } from '../classic-ids/label-merge/classic-id-overrides-source';
import {
  LABEL_FLIPS,
} from '../classic-ids/label-merge/label-flips-tsv';
import {
  readMultiplesTsv,
  sourceIdsWithSiblingComponent,
} from '../companions/companion-promotion';
import { readMagnitudeTerm } from './magnitude-term/magnitude-term';
import { MAGNITUDE_FLOOR_V } from './magnitude-term/magnitude-term-pure';
import { INHERITED_SPINE } from '../spine/inherited-spine-tsv';
import { ORIGIN_KEYS } from './origin-keys';
import { loadPrimaryTables } from '../spine/primaries-tables';
import {
  MEMBERSHIP_EXPECTED_FILE,
  buildMembership,
  type MembershipCounts,
} from './membership-manifest-pure';
import { ADDITIONS_LEDGER } from './additions-ledger-tsv';
import { BINDING_REVIEW } from './binding-review-tsv';
import { LABEL_DROPS } from './label-drops-tsv';
import { MEMBERSHIP_MANIFEST } from './membership-manifest-tsv';
import { BINDING_REVIEW_DISPOSITIONS } from './binding-review-dispositions-source';
import { SPINE_CORRECTIONS } from './spine-corrections-source';


/** Per-identifier overlay coverage over the membership term, as a ratio of the
 *  merge's own counts — the same walk that decides what the manifest ships. */
function reportLabelCoverage(c: MembershipCounts): void {
  console.log(
    `label merge over ${c.spineRows} spine rows: ${c.labelNoOverlayEntry} have no overlay ` +
      `entry at all (${c.spineRowsWithoutSourceId} bind no source; the rest bind one absent from ` +
      `both cross-walks), including ${c.spineBrightRowsWithoutOverlayEntry} of ` +
      `${c.spineBrightRows} rows at V <= ${BRIGHT_TIER_MAG_CEILING}. Those labels ride the ` +
      'inherited spine, not the overlay.',
  );
  for (const field of LABEL_FIELDS) {
    const covered = c.labelAgree[field];
    const keyed = covered + c.labelFlipped[field] + c.labelSpineOnly[field];
    const pct = keyed === 0 ? 0 : (100 * covered) / keyed;
    console.log(
      `  ${field.padEnd(6)} ${String(covered).padStart(7)} / ${String(keyed).padStart(7)}` +
        ` (${pct.toFixed(1)}%) — added ${c.labelAdded[field]}, ` +
        `flipped ${c.labelFlipped[field]}, ` +
        `suppressed ${c.labelSuppressed[field]}, ` +
        `extras aliased ${c.labelExtraAlias[field]}, ` +
        `sibling-rendered ${c.labelExtraSiblingRendered[field]}, ` +
        `extras dropped ${c.labelExtraDropped[field]}, ` +
        `overridden ${c.labelOverridden[field]}`,
    );
  }
}

async function main(): Promise<void> {
  const spine = readArtifact(INHERITED_SPINE);
  const multiples = readMultiplesTsv();
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const { evidence, gaiaAstrometry } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), tables.tycho2, tables.gliese),
  );
  const result = buildMembership({
    spine,
    tables,
    overlay: overlayMap(artifactRows(CLASSIC_ID_OVERLAY)),
    overrides: CLASSIC_ID_OVERRIDES.read(),
    siblingRenderedSourceIds: sourceIdsWithSiblingComponent(multiples),
    evidence,
    dispositions: BINDING_REVIEW_DISPOSITIONS.read(),
    corrections: SPINE_CORRECTIONS.read(),
    magnitudeTerm: MAGNITUDE_FLOOR_V === null
      ? null
      : await readMagnitudeTerm(MAGNITUDE_FLOOR_V),
    publishesGaiaParallax: (sourceId) => {
      const row = gaiaAstrometry.get(sourceId);
      return row !== undefined && gaiaHas5pSolution(row);
    },
    keys: ORIGIN_KEYS,
  });

  const c = result.counts;
  console.log(
    `manifest: ${c.rows} rows — ${c.spineRows} from the spine, ${c.additionRows} admitted ` +
      `(${Object.entries(c.additionsByReason).map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
      `${c.componentRows} groups resolve onto an existing record`,
  );
  console.log(
    MAGNITUDE_FLOOR_V === null
      ? 'magnitude term: off — membership is the primaries alone'
      : `magnitude term at V <= ${MAGNITUDE_FLOOR_V}: ${c.magnitudeTerm.rows} pull rows — ` +
        `kept ${c.magnitudeTerm.kept}, above the floor ${c.magnitudeTerm.above_floor}, ` +
        `no transformed V ${c.magnitudeTerm.no_v}; ${c.magnitudeRows} rows after the ` +
        'primaries dedupe',
  );
  const tally = (counts: Record<string, number>): string =>
    Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(
    `derivation: ${tally(c.derivationOutcome)}; ` +
      `via ${tally(c.derivedVia)}, consensus ${c.derivedConsensus}, asserted by review ${c.dispositionAsserted}; ` +
      `gate refused ${tally(c.derivedRejected)}; ` +
      `${c.derivedUngateable} rows have a candidate and no printed V; ` +
      `${c.derivedWeighedNoGMag} candidates weighed with no pulled row (must be 0), ` +
      `${c.derivedWeighedNullGMag} on a row with no published G`,
  );
  console.log(
    `bindings: crosswalk_gated ${c.bindingByClass.crosswalk_gated}, ` +
      `simbad_corroborated ${c.bindingByClass.simbad_corroborated}, ` +
      `reviewed ${c.bindingByClass.reviewed}, none ${c.bindingByClass.none}; ` +
      `review queue ${tally(c.bindingReviewByVerdict)}, disposed ${tally(c.bindingDispositions)}; ` +
      'additions with a source on the spine ' +
      `${c.additionSourceOnSpine}, gate-refused ${c.additionSourceGateRefused}, ` +
      `shared ${c.additionSourceShared}, TYC/HIP route disagreement ${c.additionRouteSourceDisagree}; ` +
      `${c.additionGaiaKeyedOnly} admitted rows keyed on the Gaia id alone`,
  );
  console.log(
    `spine corrections: ${c.spineRowsFolded} rows folded, ` +
      `${Object.entries(c.spineCellsCorrected).map(([k, v]) => `${k} ${v}`).join(', ')} cells set`,
  );
  console.log(
    `unattested cells: ${Object.entries(c.unattestedByCell).map(([k, v]) => `${k} ${v}`).join(', ')}; ` +
      `labels dropped: ${Object.entries(c.labelDropsByReason).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  reportLabelCoverage(c);

  const lineage = await stageLineage({
    layout: LINEAGE_LAYOUT,
    spec: MEMBERSHIP_LINEAGE,
    script: 'build:membership',
    diffed: 'membership',
    rows: result.lineage,
    render: (sorted) => ({
      membership: stageLineageText(MEMBERSHIP_CODES, sorted),
      identity: identityText(result.identity),
    }),
    joins: (baselineDir) => {
      const baseline = readIdentity(stageFile(baselineDir, 'identity'));
      const identity = new Map([...baseline, ...result.identity].map((r) => [r.key, r]));
      return [multiplesComponentJoin(identity, multiples)];
    },
    budget: MEMBERSHIP_LINEAGE_BUDGET,
    argv: process.argv.slice(2),
  });
  if (lineage.changes !== null) {
    const kinds = ['added', 'removed', 'changed'] as const;
    console.log(`lineage diff: ${kinds.map((k) => `${lineage.changes!.filter((x) => x.kind === k).length} ${k}`).join(', ')} keys`);
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
    checks: [...lineage.checks, snapshotCheck<MembershipCounts>({
      envVar: 'UPDATE_BUILD_COUNTS',
      snapshotPath: resolve(ROOT, MEMBERSHIP_EXPECTED_FILE),
      actual: c,
      compare: compareCountSnapshot,
      failureLabel: 'membership-manifest count',
      refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:membership',
    })],
  });
  for (const f of Object.values(MEMBERSHIP_OUTPUTS.files)) console.log(`wrote ${f}`);
}

runStep(main);
