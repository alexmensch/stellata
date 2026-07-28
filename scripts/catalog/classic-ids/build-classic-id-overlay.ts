// Emit data/classic-ids/classic_id_overlay.tsv — the source_id-keyed classic
// designation overlay. See README.md.
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';

import { parseGaiaSourceIdStr, resolveGaiaSourceId } from '../catalog-pure';
import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import { nonEmpty, parseFloatOrNull, parseIntOrNull } from '../parse/corpus-tsv';
import {
  parseBsc5Tsv,
  parseCns5Tsv,
  parseCrossIndexTsv,
  parseTyc2HdTsv,
} from './classic-ids-parse';
import {
  athygIdOrNull,
  BRIGHT_TIER_MAG_CEILING,
  buildClassicIdOverlay,
  measureAthygLabelParity,
  serializeOverlay,
  type AthygLabelRow,
  type ClassicIdOverlay,
  type ClassicIdOverlayCounts,
  type HdHipRouteDisagreement,
} from './classic-id-overlay-pure';
import { REPO_ROOT as ROOT } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';

const SRC_TYC2_HD = resolve(ROOT, 'data/classic-ids/tyc2_hd.tsv');
const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');
const SRC_CNS5 = resolve(ROOT, 'data/classic-ids/cns5.tsv');
const SRC_TYC_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_tyc_xmatch.tsv');
const SRC_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const SRC_ATHYG = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');

const OUT_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const OUT_DISAGREEMENTS = resolve(
  ROOT,
  'data/classic-ids/hd_hip_route_disagreements.tsv',
);
const EXPECTED_COUNTS = resolve(
  ROOT,
  'scripts/catalog/classic-ids/classic-id-overlay-expected.json',
);

function requireExists(path: string): void {
  if (existsSync(path)) return;
  console.error(
    `Missing ${path}. Confirm git LFS is pulled (\`git lfs pull\`); refresh ` +
      `the CDS inputs with \`pnpm run refresh:classic-ids\`.`,
  );
  process.exit(1);
}

function readRequired(path: string): string {
  requireExists(path);
  return readFileSync(path, 'utf8');
}

async function readAthygLabelRows(
  hipToSource: ReadonlyMap<number, string>,
): Promise<AthygLabelRow[]> {
  const parser = createReadStream(SRC_ATHYG).pipe(
    parse({ columns: true, skip_empty_lines: true, cast: false }),
  );
  const rows: AthygLabelRow[] = [];
  for await (const row of parser) {
    // The same native-gaia → HIP-cross-walk precedence build-catalog.ts and
    // export-astrometry-request.ts use, so parity is measured against the
    // source_id the shipped pipeline would key this row on.
    const { gaiaSourceId } = resolveGaiaSourceId(
      parseGaiaSourceIdStr(row.gaia),
      athygIdOrNull(row.hip),
      hipToSource as Map<number, string>,
    );
    rows.push({
      sourceId: gaiaSourceId,
      mag: parseFloatOrNull(row.mag),
      hd: athygIdOrNull(row.hd),
      hip: athygIdOrNull(row.hip),
      hr: athygIdOrNull(row.hr),
      gl: nonEmpty(row.gl),
      bayer: nonEmpty(row.bayer),
      flam: parseIntOrNull(row.flam),
    });
  }
  return rows;
}

function writeDisagreements(rows: readonly HdHipRouteDisagreement[]): void {
  const lines = ['hd\thip\thd_route_source_ids\thip_route_source_id'];
  for (const d of [...rows].sort((a, b) => a.hd - b.hd)) {
    lines.push(`${d.hd}\t${d.hip}\t${d.hdRouteSourceIds.join('|')}\t${d.hipRouteSourceId}`);
  }
  writeFileSync(OUT_DISAGREEMENTS, `${lines.join('\n')}\n`);
}

function reportCoverage(counts: ClassicIdOverlayCounts): void {
  const p = counts.athygLabelParity;
  const pairs: [string, number, number][] = [
    ['hd', p.hdKeyed, p.hdCovered],
    ['hip', p.hipKeyed, p.hipCovered],
    ['hr', p.hrKeyed, p.hrCovered],
    ['gl', p.glKeyed, p.glCovered],
    ['bayer', p.bayerKeyed, p.bayerCovered],
    ['flam', p.flamKeyed, p.flamCovered],
  ];
  console.log(
    `AT-HYG label parity over ${counts.athygRows} rows: ` +
      `${counts.athygRowsWithoutOverlayEntry} have no overlay entry at all ` +
      `(${counts.athygRowsWithoutSourceId} reach no source_id; the rest resolve ` +
      `to a source_id absent from both cross-walks), including ` +
      `${counts.athygBrightRowsWithoutOverlayEntry} of ${counts.athygBrightRows} ` +
      `rows at V <= ${BRIGHT_TIER_MAG_CEILING}. Those labels ride the ` +
      `inherited spine, not the overlay.`,
  );
  for (const [name, keyed, covered] of pairs) {
    const pct = keyed === 0 ? 0 : (100 * covered) / keyed;
    console.log(
      `  ${name.padEnd(6)} ${String(covered).padStart(7)} / ${String(keyed).padStart(7)}` +
        ` (${pct.toFixed(1)}%)`,
    );
  }
}

function logOverlay(overlay: ClassicIdOverlay, counts: ClassicIdOverlayCounts): void {
  console.log(
    `overlay: ${overlay.size} source_ids — hd ${counts.overlayHd}, ` +
      `hip ${counts.overlayHip}, hr ${counts.overlayHr}, gj ${counts.overlayGj}, ` +
      `bayer ${counts.overlayBayer}, flamsteed ${counts.overlayFlamsteed}`,
  );
  console.log(
    `HD→TYC route: ${counts.tycResolvedToSource} / ${counts.tyc2HdDistinctTyc} ` +
      `IV/25 Tycho ids resolve (${counts.tycUnresolved} absent from the ` +
      `best-neighbour walk); HIP-route cross-check ${counts.hdHipRouteAgree} agree, ` +
      `${counts.hdHipRouteDisagree} disagree, ${counts.hdHipRouteHipOnly} HIP-only`,
  );
}

async function main(): Promise<void> {
  const tyc2Hd = parseTyc2HdTsv(readRequired(SRC_TYC2_HD));
  const crossIndex = parseCrossIndexTsv(readRequired(SRC_CROSS_INDEX));
  const bsc5 = parseBsc5Tsv(readRequired(SRC_BSC5));
  const cns5 = parseCns5Tsv(readRequired(SRC_CNS5));

  requireExists(SRC_TYC_XMATCH);
  requireExists(SRC_HIP_XMATCH);
  requireExists(SRC_ATHYG);
  const hipToSource = readGaiaHipXmatch(SRC_HIP_XMATCH);
  const tycToSource = await readGaiaTycXmatch(
    SRC_TYC_XMATCH,
    new Set(tyc2Hd.map((r) => r.tyc)),
  );

  const { overlay, counts: joinCounts, disagreements } = buildClassicIdOverlay({
    tyc2Hd,
    crossIndex,
    bsc5,
    cns5,
    tycToSource,
    hipToSource,
  });

  const athygRows = await readAthygLabelRows(hipToSource);
  const parity = measureAthygLabelParity(athygRows, overlay);

  const counts: ClassicIdOverlayCounts = {
    ...joinCounts,
    athygRows: parity.rows,
    athygRowsWithoutSourceId: parity.rowsWithoutSourceId,
    athygRowsWithoutOverlayEntry: parity.rowsWithoutOverlayEntry,
    athygBrightRows: parity.brightRows,
    athygBrightRowsWithoutOverlayEntry: parity.brightRowsWithoutOverlayEntry,
    athygLabelParity: parity.parity,
  };

  writeFileSync(OUT_OVERLAY, serializeOverlay(overlay));
  writeDisagreements(disagreements);
  logOverlay(overlay, counts);
  reportCoverage(counts);
  console.log(`wrote ${OUT_OVERLAY}`);
  console.log(`wrote ${OUT_DISAGREEMENTS} (${disagreements.length} rows)`);

  await assertOrUpdateSnapshot<ClassicIdOverlayCounts>({
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
    failureLabel: 'classic-id-overlay count',
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:classic-ids',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
