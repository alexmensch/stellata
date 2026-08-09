// Emit data/gaia/gaia_catalog_source_id_request.tsv — the deduped,
// numerically-sorted Gaia DR3 source_id list for every spine row carrying one.
// See README.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import { INHERITED_SPINE_FILE, iterSpineTsv } from '../spine/inherited-spine-pure';
import { REPO_ROOT as ROOT } from '../../util/paths';

const SRC_SPINE = resolve(ROOT, INHERITED_SPINE_FILE);
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

function main(): void {
  const ids = new Set<string>();
  let rows = 0;
  let withoutSourceId = 0;
  for (const row of iterSpineTsv(readFileSync(SRC_SPINE, 'utf8'))) {
    rows++;
    if (row.gaia_source_id === '') withoutSourceId++;
    else ids.add(row.gaia_source_id);
  }

  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(OUT, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(
    `read ${rows} spine rows → ${sorted.length} unique source_ids ` +
      `(${withoutSourceId} rows carry none)`,
  );
  console.log(`wrote ${OUT}`);
}

main();
