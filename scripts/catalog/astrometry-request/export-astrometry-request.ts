// Emit data/gaia/gaia_catalog_source_id_request.tsv — every Gaia source the
// build needs a row for: the spine's membership column, plus the classic-ID
// gate's candidates. See README.md.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import {
  bindingCandidateSourceIds,
  loadBindingCandidateInputs,
} from '../classic-ids/binding-candidates';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { INHERITED_SPINE_FILE, iterSpineTsv } from '../spine/inherited-spine-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';

const SRC_SPINE = resolve(ROOT, INHERITED_SPINE_FILE);
const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

const SPINE_HINT = 'the spine is committed, so a missing one means an incomplete checkout.';
const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';

function main(): void {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of iterSpineTsv(readRequired(SRC_SPINE, SPINE_HINT))) {
    rows++;
    if (row.gaia_source_id === '') withoutSourceId++;
    else ids.add(row.gaia_source_id);
  }
  const membership = ids.size;

  const { vmag: hipVMag } = parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT));
  const candidates = bindingCandidateSourceIds(loadBindingCandidateInputs(), hipVMag);
  for (const id of candidates) ids.add(id);

  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(OUT, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(
    `spine: ${rows} rows → ${membership} source_ids (${withoutSourceId} carry none)`,
  );
  console.log(
    `classic-ID gate candidates: ${candidates.size} ` +
      `(+${sorted.length - membership} beyond the spine)`,
  );
  console.log(`wrote ${OUT} (${sorted.length} source_ids)`);
}

main();
