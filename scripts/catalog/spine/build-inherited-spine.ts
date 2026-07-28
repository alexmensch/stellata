// Emit data/athyg/inherited-spine.tsv — one row per AT-HYG-derived record of
// the final AT-HYG-driven build. One-shot; see README.md.
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';

import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { CONSTELLATIONS, CON_INDEX } from '../parse/constellations';
import { readStars, type Star } from '../parse/stars-parse';
import { ATHYG_CSV, loadReadStarsInputs } from '../parse/read-stars-inputs';
import {
  backfillPrimaryIdentifiers,
  promoteCompanions,
  readMultiplesTsv,
} from '../companions/companion-promotion';
import { applySystemDistanceCoherence } from '../multiplicity/system-coherence';
import {
  INHERITED_SPINE_FILE,
  SPINE_PRINTED_COLUMNS,
  buildSpineRow,
  serializeSpine,
  spineCounts,
  type SpineCounts,
  type SpinePrintedCells,
  type SpineRow,
} from './inherited-spine-pure';
import { REPO_ROOT as ROOT } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';

const SRC_MULTIPLES = resolve(ROOT, 'data/binaries/multiples.tsv');
const OUT_SPINE = resolve(ROOT, INHERITED_SPINE_FILE);
const EXPECTED_COUNTS = resolve(
  ROOT,
  'scripts/catalog/spine/inherited-spine-expected.json',
);

/** Printed cells for every AT-HYG row, keyed by the row's `id`. A second pass
 *  over the CSV rather than extra fields on `Star`: the build's record type
 *  carries only what a catalog.bin field or a cross-match pass needs. */
async function readPrintedCells(): Promise<Map<number, SpinePrintedCells>> {
  const parser = createReadStream(ATHYG_CSV).pipe(
    parse({ columns: true, skip_empty_lines: true, cast: false }),
  ) as AsyncIterable<Record<string, string>>;
  const byRowId = new Map<number, SpinePrintedCells>();
  for await (const row of parser) {
    const cells = {} as SpinePrintedCells;
    for (const column of SPINE_PRINTED_COLUMNS) cells[column] = row[column] ?? '';
    byRowId.set(Number(row.id), cells);
  }
  return byRowId;
}

/** The AT-HYG-derived record set with its designation set final: readStars'
 *  membership decisions, then every pass that writes an identifier onto one of
 *  those records before SID resolution sees them — so the frozen designation
 *  set is the one `starDesignations` extracts today. */
async function readAthygDerivedRecords(): Promise<Star[]> {
  const inputs = loadReadStarsInputs();
  console.log(`Reading ${ATHYG_CSV}...`);
  const { stars, stats } = await readStars(
    ATHYG_CSV, CON_INDEX, inputs.bjMap, inputs.hipToGaia, inputs.simbadSpectral,
    inputs.apsisMap, inputs.directions, inputs.dustGrid, inputs.wdsXids,
  );
  console.log(`  parsed ${stats.total} rows, kept ${stars.length}`);
  console.log('  dropped:', stats.dropped);

  if (!existsSync(SRC_MULTIPLES)) {
    console.error(
      `Missing ${SRC_MULTIPLES}. Confirm git LFS is pulled (\`git lfs pull\`) — ` +
        `without it the identifier passes are skipped and the spine would ` +
        `freeze a designation set the shipped build does not have.`,
    );
    process.exit(1);
  }
  const multiplesRows = readMultiplesTsv(SRC_MULTIPLES);
  const backfilled = backfillPrimaryIdentifiers(multiplesRows, stars);
  console.log(`  backfilled identifiers onto ${backfilled} HD-only primaries`);
  // Companion promotion's collocated-double merge writes a Gaia id onto the
  // AT-HYG record it repositions instead of minting a twin, so it too decides
  // a spine row's designation set. Its minted records are discarded — they are
  // not AT-HYG-derived — and the distance-coherence pass runs first because
  // that merge gates on the record sitting exactly on its anchor.
  applySystemDistanceCoherence(multiplesRows, stars, {
    gaiaAstrometry: inputs.directions.gaiaAstrometry,
    hip2: inputs.directions.hip2,
    bjMap: inputs.bjMap,
  });
  const { stats: promotion } = promoteCompanions(
    multiplesRows, stars, CONSTELLATIONS, inputs.dustGrid,
  );
  console.log(
    `  promotion repositioned ${promotion.repositionedCollocatedDouble} ` +
      `collocated AT-HYG double(s)`,
  );
  return stars;
}

function assembleRows(
  stars: readonly Star[],
  printedByRowId: ReadonlyMap<number, SpinePrintedCells>,
): SpineRow[] {
  const rows: SpineRow[] = [];
  for (const star of stars) {
    if (star.athygRowId === null) {
      throw new Error('readStars produced a record with no AT-HYG row id');
    }
    const printed = printedByRowId.get(star.athygRowId);
    if (printed === undefined) {
      throw new Error(`AT-HYG row ${star.athygRowId} vanished between passes`);
    }
    rows.push(buildSpineRow(star, printed));
  }
  return rows;
}

function reportCounts(counts: SpineCounts): void {
  console.log(`spine: ${counts.rows} rows — non-empty per column:`);
  for (const [column, n] of Object.entries(counts.nonEmpty)) {
    const pct = ((100 * n) / counts.rows).toFixed(1);
    console.log(`  ${column.padEnd(15)} ${String(n).padStart(7)} (${pct}%)`);
  }
}

async function main(): Promise<void> {
  const stars = await readAthygDerivedRecords();
  const printedByRowId = await readPrintedCells();
  // AT-HYG `id` ascending — readStars keeps CSV order, so the emitted order is
  // the upstream one and the file is reproducible without a sort key.
  const rows = assembleRows(stars, printedByRowId);
  const counts = spineCounts(rows);

  writeFileSync(OUT_SPINE, serializeSpine(rows));
  reportCounts(counts);
  console.log(`wrote ${OUT_SPINE}`);

  await assertOrUpdateSnapshot<SpineCounts>({
    envVar: 'UPDATE_BUILD_COUNTS',
    snapshotPath: EXPECTED_COUNTS,
    actual: counts,
    compare: (expected, actual) => {
      const diff = compareBuildCounts(expected, actual);
      return {
        drifted: diff.some((d) => d.status === 'mismatch'),
        report: formatCountDiff(diff),
      };
    },
    failureLabel: 'inherited-spine count',
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:spine',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
