// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the record-parity additions ledger (/docs/catalog-driver.md#61-record-parity) and the binding review queue, plus the label
// merge's review queue. See README.md.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { declareOutputs, emitArtifacts } from '../../util/emit-artifacts';
import { snapshotCheck } from '../../util/snapshot-check';
import { compareCountSnapshot } from '../build-counts';
import { loadBindingEvidence, loadHipVMag } from './binding/binding-evidence';
import { printedVLookups } from '../photometry/v-magnitude-pure';
import { gaiaHas5pSolution } from '../distance/gaia-distrust';
import {
  BRIGHT_TIER_MAG_CEILING,
  parseOverlayTsv,
} from '../classic-ids/classic-id-overlay-pure';
import {
  CLASSIC_ID_OVERRIDES_FILE,
  LABEL_FIELDS,
  LABEL_FLIPS_FILE,
  labelFlipsTsv,
  parseLabelOverridesTsv,
} from '../classic-ids/label-merge/label-merge-pure';
import {
  MULTIPLES_TSV,
  readMultiplesTsv,
  sourceIdsWithSiblingComponent,
} from '../companions/companion-promotion';
import { readMagnitudeTerm } from './magnitude-term/magnitude-term';
import { MAGNITUDE_FLOOR_V } from './magnitude-term/magnitude-term-pure';
import { INHERITED_SPINE_FILE, parseSpineTsv } from '../spine/inherited-spine-pure';
import { LFS_HINT, loadPrimaryTables } from '../spine/primaries-tables';
import {
  ADDITIONS_LEDGER_FILE,
  BINDING_DISPOSITIONS_FILE,
  BINDING_REVIEW_FILE,
  LABEL_DROPS_FILE,
  MEMBERSHIP_EXPECTED_FILE,
  MEMBERSHIP_MANIFEST_FILE,
  SPINE_CORRECTIONS_FILE,
  buildMembership,
  parseBindingDispositionsTsv,
  parseSpineCorrectionsTsv,
  serializeBindingReview,
  serializeLabelDrops,
  serializeLedger,
  serializeManifest,
  type MembershipCounts,
} from './membership-manifest-pure';

const SRC_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const OVERLAY_HINT = 'run `pnpm run build:classic-ids`.';
const DISPOSITIONS_HINT = 'dispose every row of binding-review.tsv there (README.md#the-spine-side).';
const CORRECTIONS_HINT = 'it is committed and hand-curated (README.md#correcting-a-merge-decision).';

const OUTPUT_FILES = [
  LABEL_FLIPS_FILE, MEMBERSHIP_MANIFEST_FILE, ADDITIONS_LEDGER_FILE, BINDING_REVIEW_FILE, LABEL_DROPS_FILE,
] as const;

export const MEMBERSHIP_OUTPUTS = declareOutputs(OUTPUT_FILES.map((f) => resolve(ROOT, f)));

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
  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const overridesPath = resolve(ROOT, CLASSIC_ID_OVERRIDES_FILE);
  const { evidence, gaiaAstrometry } = loadBindingEvidence(
    printedVLookups(loadHipVMag(), tables.tycho2, tables.gliese),
  );
  const result = buildMembership({
    spine,
    tables,
    overlay: parseOverlayTsv(readRequired(SRC_OVERLAY, OVERLAY_HINT)),
    overrides: existsSync(overridesPath)
      ? parseLabelOverridesTsv(readFileSync(overridesPath, 'utf8'))
      : new Map(),
    siblingRenderedSourceIds: sourceIdsWithSiblingComponent(readMultiplesTsv(MULTIPLES_TSV)),
    evidence,
    dispositions: parseBindingDispositionsTsv(
      readRequired(resolve(ROOT, BINDING_DISPOSITIONS_FILE), DISPOSITIONS_HINT),
    ),
    corrections: parseSpineCorrectionsTsv(
      readRequired(resolve(ROOT, SPINE_CORRECTIONS_FILE), CORRECTIONS_HINT),
    ),
    magnitudeTerm: MAGNITUDE_FLOOR_V === null
      ? null
      : await readMagnitudeTerm(MAGNITUDE_FLOOR_V),
    publishesGaiaParallax: (sourceId) => {
      const row = gaiaAstrometry.get(sourceId);
      return row !== undefined && gaiaHas5pSolution(row);
    },
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

  const text: Record<(typeof OUTPUT_FILES)[number], string> = {
    [LABEL_FLIPS_FILE]: labelFlipsTsv(result.flips),
    [MEMBERSHIP_MANIFEST_FILE]: serializeManifest(result.rows),
    [ADDITIONS_LEDGER_FILE]: serializeLedger(result.ledger),
    [BINDING_REVIEW_FILE]: serializeBindingReview(result.bindingReview),
    [LABEL_DROPS_FILE]: serializeLabelDrops(result.labelDrops),
  };
  emitArtifacts({
    outputs: MEMBERSHIP_OUTPUTS,
    files: new Map(OUTPUT_FILES.map((f) => [resolve(ROOT, f), text[f]])),
    checks: [snapshotCheck<MembershipCounts>({
      envVar: 'UPDATE_BUILD_COUNTS',
      snapshotPath: resolve(ROOT, MEMBERSHIP_EXPECTED_FILE),
      actual: c,
      compare: compareCountSnapshot,
      failureLabel: 'membership-manifest count',
      refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:membership',
    })],
  });
  for (const f of OUTPUT_FILES) console.log(`wrote ${f}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
