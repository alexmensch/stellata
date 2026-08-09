// Emit data/gaia/gaia_catalog_source_id_request.tsv — every Gaia source the
// build needs a row for: the spine's membership column, plus the classic-ID
// gate's candidates. See README.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import {
  bindingCandidateSourceIds,
  loadClassicIdCrossWalks,
} from '../classic-ids/binding-candidates';
import { parseHipVmagTsv } from '../photometry/hip-vmag-parse';
import { INHERITED_SPINE_FILE, iterSpineTsv } from '../spine/inherited-spine-pure';
import { REPO_ROOT as ROOT } from '../../util/paths';

const SRC_SPINE = resolve(ROOT, INHERITED_SPINE_FILE);
const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

async function main(): Promise<void> {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of iterSpineTsv(readFileSync(SRC_SPINE, 'utf8'))) {
    rows++;
    if (row.gaia_source_id === '') withoutSourceId++;
    else ids.add(row.gaia_source_id);
  }
  const membership = ids.size;

  const hipVMag = parseHipVmagTsv(readFileSync(SRC_HIP_VMAG, 'utf8'));
  const candidates = bindingCandidateSourceIds(
    await loadClassicIdCrossWalks(),
    hipVMag,
  );
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
