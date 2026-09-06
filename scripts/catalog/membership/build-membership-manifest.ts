// `pnpm run build:membership` — emit data/membership/: the membership manifest,
// the § 6.1 additions ledger and the binding review queue. See README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';
import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { parseOverlayTsv } from '../classic-ids/classic-id-overlay-pure';
import {
  CLASSIC_ID_OVERRIDES_FILE,
  LABEL_FLIPS_FILE,
  labelFlipsTsv,
  parseLabelOverridesTsv,
} from '../classic-ids/label-merge-pure';
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
  buildMembership,
  parseBindingDispositionsTsv,
  serializeBindingReview,
  serializeLabelDrops,
  serializeLedger,
  serializeManifest,
  type MembershipCounts,
} from './membership-manifest-pure';

const SRC_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const OVERLAY_HINT = 'run `pnpm run build:classic-ids`.';
const DISPOSITIONS_HINT = 'dispose every row of binding-review.tsv there (README.md § The spine side).';

function writeArtifact(repoRelative: string, text: string): void {
  const path = resolve(ROOT, repoRelative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${repoRelative}`);
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
    dispositions: parseBindingDispositionsTsv(
      readRequired(resolve(ROOT, BINDING_DISPOSITIONS_FILE), DISPOSITIONS_HINT),
    ),
  });

  // The record build still merges labels for itself and asserts its queue
  // against the committed one, so the spine side here has to reproduce that
  // queue exactly — or the manifest's labels are not the labels that ship.
  const committedFlips = readRequired(resolve(ROOT, LABEL_FLIPS_FILE), OVERLAY_HINT);
  if (labelFlipsTsv(result.flips) !== committedFlips) {
    throw new Error(
      `${LABEL_FLIPS_FILE} does not describe the spine-side labels this build derived; ` +
        'the manifest and the record build would ship different labels.',
    );
  }

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
  console.log(
    `bindings: crosswalk_gated ${c.bindingByClass.crosswalk_gated}, ` +
      `simbad_corroborated ${c.bindingByClass.simbad_corroborated}, ` +
      `reviewed ${c.bindingByClass.reviewed}, none ${c.bindingByClass.none}; ` +
      `${c.bindingReviewRows} spine bindings in review; additions with a source on the spine ` +
      `${c.additionSourceOnSpine}, gate-refused ${c.additionSourceGateRefused}, ` +
      `shared ${c.additionSourceShared}, TYC/HIP route disagreement ${c.additionRouteSourceDisagree}; ` +
      `${c.additionGaiaKeyedOnly} admitted rows keyed on the Gaia id alone`,
  );
  console.log(
    `unattested cells: ${Object.entries(c.unattestedByCell).map(([k, v]) => `${k} ${v}`).join(', ')}; ` +
      `labels dropped: ${Object.entries(c.labelDropsByReason).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );

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
