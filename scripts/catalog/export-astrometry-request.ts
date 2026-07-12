// Emit data/gaia/gaia_catalog_source_id_request.tsv — the deduped,
// numerically-sorted Gaia DR3 source_id list for every resolvable AT-HYG
// row. See scripts/catalog/README.md § Full-catalog astrometry request.
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';

import { resolveGaiaSourceId, parseGaiaSourceIdStr } from './catalog-pure';
import { readGaiaHipXmatch } from './gaia-xmatch';
import { parseIntOrNull } from './stars-parse';
import { sortSourceIdsNumeric } from './export-astrometry-request-pure';
import { REPO_ROOT as ROOT } from '../util/paths';

const SRC_CSV = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');
const SRC_GAIA_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const OUT = resolve(ROOT, 'data/gaia/gaia_catalog_source_id_request.tsv');

async function main(): Promise<void> {
  if (!existsSync(SRC_CSV)) {
    console.error(`Source CSV not found: ${SRC_CSV}`);
    process.exit(1);
  }

  let hipToGaia: Map<number, string> | null = null;
  if (existsSync(SRC_GAIA_HIP_XMATCH)) {
    hipToGaia = readGaiaHipXmatch(SRC_GAIA_HIP_XMATCH);
    console.log(`HIP→Gaia cross-walk: ${hipToGaia.size} entries`);
  } else {
    console.warn(
      `WARNING: ${SRC_GAIA_HIP_XMATCH} not found — HIP-backfilled source_ids\n` +
        `         will be omitted. Run pnpm run refresh:gaia-hip first.`,
    );
  }

  const parser = createReadStream(SRC_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, cast: false }),
  );

  const ids = new Set<string>();
  let total = 0;
  let backfilled = 0;
  for await (const row of parser) {
    total++;
    const { gaiaSourceId, backfilled: bf } = resolveGaiaSourceId(
      parseGaiaSourceIdStr(row.gaia),
      parseIntOrNull(row.hip),
      hipToGaia,
    );
    if (gaiaSourceId !== null) {
      ids.add(gaiaSourceId);
      if (bf) backfilled++;
    }
  }

  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(OUT, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(
    `read ${total} AT-HYG rows → ${sorted.length} unique source_ids ` +
      `(${backfilled} via HIP cross-walk backfill)`,
  );
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
