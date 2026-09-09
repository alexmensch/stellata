// Emit data/classic-ids/classic_id_overlay.tsv — the source_id-keyed classic
// designation overlay. See README.md.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { loadClassicIdCrossWalks } from './binding-candidates';
import { loadBindingEvidence } from './binding-evidence';
import { parseBsc5Tsv } from './classic-ids-parse';
import { readCrossIndexTable } from './cross-index';
import {
  OVERLAY_VALUE_SEPARATOR,
  buildClassicIdOverlay,
  serializeOverlay,
  type ClassicIdOverlay,
  type OverlayJoinCounts,
  type HdHipRouteDisagreement,
  type RejectedBinding,
} from './classic-id-overlay-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';

const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';

const OUT_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const OUT_DISAGREEMENTS = resolve(
  ROOT,
  'data/classic-ids/hd_hip_route_disagreements.tsv',
);
const OUT_REJECTED = resolve(ROOT, 'data/classic-ids/rejected_bindings.tsv');
const EXPECTED_COUNTS = resolve(
  ROOT,
  'scripts/catalog/classic-ids/classic-id-overlay-expected.json',
);

function writeTsv(path: string, header: string, rows: readonly string[]): void {
  writeFileSync(path, `${[header, ...rows].join('\n')}\n`);
}

function writeDisagreements(rows: readonly HdHipRouteDisagreement[]): void {
  const sep = OVERLAY_VALUE_SEPARATOR;
  writeTsv(
    OUT_DISAGREEMENTS,
    'hd\thip\thd_route_source_ids\thip_route_source_id',
    [...rows]
      .sort((a, b) => a.hd - b.hd)
      .map((d) => `${d.hd}\t${d.hip}\t${d.hdRouteSourceIds.join(sep)}\t${d.hipRouteSourceId}`),
  );
}

function writeRejectedBindings(rows: readonly RejectedBinding[]): void {
  writeTsv(
    OUT_REJECTED,
    'gaia_source_id\thip\tv_mag\tg_mag\treason\tdesignations',
    [...rows]
      .sort((a, b) => a.hip - b.hip)
      .map((r) => [
        r.sourceId,
        r.hip,
        r.vMag.toFixed(3),
        r.gMag === null ? '' : r.gMag.toFixed(3),
        r.reason,
        r.designations,
      ].join('\t')),
  );
}

function logOverlay(overlay: ClassicIdOverlay, counts: OverlayJoinCounts): void {
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
  console.log(
    `binding gate: dropped ${counts.gateRejectedMag} rows on G−V, ` +
      `${counts.gateRejectedSibling} on sibling-letter attribution; ` +
      `${counts.gateSkippedNoHipVMag} rows carry no printed V under any HIP and ` +
      `cannot be vetted; ${counts.gateSkippedNoGMag} gateable rows are absent ` +
      `from the astrometry pull (must be 0 — the request under-covers the ` +
      `candidates), ${counts.gateSkippedNullGMag} have a row but no published G`,
  );
}

async function main(): Promise<void> {
  const crossIndex = readCrossIndexTable();
  const bsc5 = parseBsc5Tsv(readRequired(SRC_BSC5, CDS_HINT));

  const { evidence } = loadBindingEvidence();

  const { tyc2Hd, cns5, tycToSource, hipToSource } = await loadClassicIdCrossWalks();

  const {
    overlay,
    counts: joinCounts,
    disagreements,
    rejectedBindings,
  } = buildClassicIdOverlay({
    tyc2Hd,
    crossIndex,
    bsc5,
    cns5,
    tycToSource,
    hipToSource,
    evidence,
  });

  writeFileSync(OUT_OVERLAY, serializeOverlay(overlay));
  writeDisagreements(disagreements);
  writeRejectedBindings(rejectedBindings);
  logOverlay(overlay, joinCounts);
  console.log(`wrote ${OUT_OVERLAY}`);
  console.log(`wrote ${OUT_DISAGREEMENTS} (${disagreements.length} rows)`);
  console.log(`wrote ${OUT_REJECTED} (${rejectedBindings.length} rows)`);

  await assertOrUpdateSnapshot<OverlayJoinCounts>({
    envVar: 'UPDATE_BUILD_COUNTS',
    snapshotPath: EXPECTED_COUNTS,
    actual: joinCounts,
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
