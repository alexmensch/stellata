// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the § 6.1 additions ledger and the binding review queue, plus the label
// merge's review queue. See README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';
import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { loadBindingEvidence } from '../classic-ids/binding-evidence';
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
const DISPOSITIONS_HINT = 'dispose every row of binding-review.tsv there (README.md § The spine side).';
const CORRECTIONS_HINT = 'it is committed and hand-curated (README.md § Correcting a merge decision).';

function writeArtifact(repoRelative: string, text: string): void {
  const path = resolve(ROOT, repoRelative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${repoRelative}`);
}

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
  const result = buildMembership({
    spine,
    tables,
    overlay: parseOverlayTsv(readRequired(SRC_OVERLAY, OVERLAY_HINT)),
    overrides: existsSync(overridesPath)
      ? parseLabelOverridesTsv(readFileSync(overridesPath, 'utf8'))
      : new Map(),
    siblingRenderedSourceIds: sourceIdsWithSiblingComponent(readMultiplesTsv(MULTIPLES_TSV)),
    evidence: loadBindingEvidence().evidence,
    dispositions: parseBindingDispositionsTsv(
      readRequired(resolve(ROOT, BINDING_DISPOSITIONS_FILE), DISPOSITIONS_HINT),
    ),
    corrections: parseSpineCorrectionsTsv(
      readRequired(resolve(ROOT, SPINE_CORRECTIONS_FILE), CORRECTIONS_HINT),
    ),
  });

  writeArtifact(LABEL_FLIPS_FILE, labelFlipsTsv(result.flips));
  writeArtifact(MEMBERSHIP_MANIFEST_FILE, serializeManifest(result.rows));
  writeArtifact(ADDITIONS_LEDGER_FILE, serializeLedger(result.ledger));
  writeArtifact(BINDING_REVIEW_FILE, serializeBindingReview(result.bindingReview));
  writeArtifact(LABEL_DROPS_FILE, serializeLabelDrops(result.labelDrops));

  const c = result.counts;
  console.log(
    `manifest: ${c.rows} rows — ${c.spineRows} from the spine, ${c.additionRows} admitted ` +
      `(${Object.entries(c.additionsByReason).map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
      `${c.componentRows} groups resolve onto an existing record`,
  );
  const tally = (counts: Record<string, number>): string =>
    Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(
    `derived against the frozen column: ${tally(c.derivedVsFrozen)}; ` +
      `via ${tally(c.derivedVia)}, consensus ${c.derivedConsensus}; ` +
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

  await assertOrUpdateSnapshot<MembershipCounts>({
    envVar: 'UPDATE_BUILD_COUNTS',
    snapshotPath: resolve(ROOT, MEMBERSHIP_EXPECTED_FILE),
    actual: c,
    compare: (expected, actual) => {
      const diff = compareBuildCounts(expected, actual);
      return {
        drifted: diff.some((d) => d.status === 'mismatch'),
        report: formatCountDiff(diff),
      };
    },
    failureLabel: 'membership-manifest count',
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:membership',
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
