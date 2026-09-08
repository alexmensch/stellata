// Emit data/gaia/gaia_catalog_source_id_request.tsv — every Gaia source the
// build needs a row for: the membership manifest's bindings, both gates'
// candidates, bound-pair siblings. See README.md.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import {
  bindingCandidateSourceIds,
  loadBindingCandidateInputs,
} from '../classic-ids/binding-candidates';
import { HIP_VMAG_HINT, SRC_HIP_VMAG } from '../classic-ids/binding-evidence';
import { MULTIPLES_TSV, readMultiplesTsv } from '../companions/companion-promotion';
import { pairMemberSourceIds } from '../distance/parallax/pair-member-parallax';
import {
  derivationCandidateSourceIds,
  indexSimbadSources,
} from '../membership/binding-derivation-pure';
import {
  MEMBERSHIP_MANIFEST_FILE,
  iterManifestTsv,
} from '../membership/membership-manifest-pure';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { INHERITED_SPINE_FILE, parseSpineTsv } from '../spine/inherited-spine-pure';
import { indexCns5 } from '../spine/primaries-audit-pure';
import { LFS_HINT, loadBindingTables } from '../spine/primaries-tables';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';

const SRC_MANIFEST = resolve(ROOT, MEMBERSHIP_MANIFEST_FILE);
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

const MANIFEST_HINT = 'run `pnpm run build:membership`, or `git lfs pull` if it is an LFS stub.';

async function main(): Promise<void> {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of iterManifestTsv(readRequired(SRC_MANIFEST, MANIFEST_HINT))) {
    rows++;
    if (row.gaia_source_id === '') withoutSourceId++;
    else ids.add(row.gaia_source_id);
  }
  const membership = ids.size;

  const { vmag: hipVMag } = parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT));
  const candidates = bindingCandidateSourceIds(loadBindingCandidateInputs(), hipVMag);
  for (const id of candidates) ids.add(id);
  const afterGate = ids.size;

  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const tables = await loadBindingTables(new Set(spine.map((r) => r.tyc).filter((t) => t !== '')));
  const derivation = derivationCandidateSourceIds(
    spine, tables, indexCns5(tables.cns5).cns5ByOwnKey, indexSimbadSources(tables.simbadBySourceId),
  );
  for (const id of derivation) ids.add(id);
  const afterDerivation = ids.size;

  const siblings = pairMemberSourceIds(readMultiplesTsv(MULTIPLES_TSV));
  for (const id of siblings) ids.add(id);

  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(OUT, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(
    `manifest: ${rows} rows → ${membership} source_ids (${withoutSourceId} carry none)`,
  );
  console.log(
    `classic-ID gate candidates: ${candidates.size} ` +
      `(+${afterGate - membership} beyond the manifest)`,
  );
  console.log(
    `binding-derivation candidates: ${derivation.size} ` +
      `(+${afterDerivation - afterGate} beyond the two above)`,
  );
  console.log(
    `bound-pair siblings: ${siblings.size} ` +
      `(+${sorted.length - afterDerivation} beyond the three above)`,
  );
  console.log(`wrote ${OUT} (${sorted.length} source_ids)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
