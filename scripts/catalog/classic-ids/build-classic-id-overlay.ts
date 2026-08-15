// Emit data/classic-ids/classic_id_overlay.tsv — the source_id-keyed classic
// designation overlay — plus the label merge's review queue. See README.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseSimbadWdsXidsTsv,
  type SimbadWdsXidIndex,
} from '../catalog-pure';
import { compareBuildCounts, formatCountDiff } from '../build-counts';
import { parseGaiaAstrometryCatalogTsv } from '../distance/direction-cascade';
import { parseFloatOrNull } from '../parse/corpus-tsv';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import { INHERITED_SPINE_FILE, iterSpineTsv } from '../spine/inherited-spine-pure';
import { loadClassicIdCrossWalks } from './binding-candidates';
import {
  parseBsc5Tsv,
  parseCrossIndexTsv,
} from './classic-ids-parse';
import {
  bindingEvidence,
  BRIGHT_TIER_MAG_CEILING,
  OVERLAY_VALUE_SEPARATOR,
  buildClassicIdOverlay,
  serializeOverlay,
  type ClassicIdOverlay,
  type ClassicIdOverlayCounts,
  type HdHipRouteDisagreement,
  type RejectedBinding,
} from './classic-id-overlay-pure';
import {
  CLASSIC_ID_OVERRIDES_FILE,
  LABEL_FIELDS,
  LABEL_FLIPS_FILE,
  labelFlipsTsv,
  mergeClassicIdLabels,
  parseLabelOverridesTsv,
  spineLabelMergeRecord,
  type LabelMergeRecord,
} from './label-merge-pure';
import { readRequired, REPO_ROOT as ROOT } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';

const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');
const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');

const SRC_SPINE = resolve(ROOT, INHERITED_SPINE_FILE);
const SRC_OVERRIDES = resolve(ROOT, CLASSIC_ID_OVERRIDES_FILE);

const CDS_HINT = 'refresh the CDS inputs with `pnpm run refresh:classic-ids`.';
const ASTROMETRY_HINT = 'run `pnpm run refresh:gaia-astrometry-catalog`.';
const HIP_VMAG_HINT = 'run `pnpm run refresh:hip-vmag`.';
const SIMBAD_HINT = 'run `python3 scripts/refresh/refresh-simbad-wds-xids.py`.';
const SPINE_HINT = 'the spine is committed, so a missing one means an incomplete checkout.';

const OUT_OVERLAY = resolve(ROOT, 'data/classic-ids/classic_id_overlay.tsv');
const OUT_LABEL_FLIPS = resolve(ROOT, LABEL_FLIPS_FILE);
const OUT_DISAGREEMENTS = resolve(
  ROOT,
  'data/classic-ids/hd_hip_route_disagreements.tsv',
);
const OUT_REJECTED = resolve(ROOT, 'data/classic-ids/rejected_bindings.tsv');
const EXPECTED_COUNTS = resolve(
  ROOT,
  'scripts/catalog/classic-ids/classic-id-overlay-expected.json',
);

interface SpineLabelSide {
  records: LabelMergeRecord[];
  labels: string[];
  rows: number;
  brightRows: number;
  brightRowsWithoutOverlayEntry: number;
  rowsWithoutSourceId: number;
  rowsWithoutOverlayEntry: number;
}

/** The membership term's side of the merge. Every spine row already carries the
 *  source_id the shipped record keys on — the native-cell → HIP-cross-walk
 *  precedence and both binding gates ran when the spine was frozen — so unlike
 *  the AT-HYG CSV this file replaced, nothing here re-resolves a binding
 *  (`../spine/README.md` § The identifier columns are read, never
 *  re-derived). */
function readSpineLabelSide(overlay: ClassicIdOverlay): SpineLabelSide {
  const side: SpineLabelSide = {
    records: [], labels: [], rows: 0, brightRows: 0,
    brightRowsWithoutOverlayEntry: 0, rowsWithoutSourceId: 0,
    rowsWithoutOverlayEntry: 0,
  };
  for (const row of iterSpineTsv(readRequired(SRC_SPINE, SPINE_HINT))) {
    const { record, label } = spineLabelMergeRecord(row);
    side.records.push(record);
    side.labels.push(label);
    side.rows++;
    const mag = parseFloatOrNull(row.mag);
    const isBright = mag !== null && mag <= BRIGHT_TIER_MAG_CEILING;
    if (isBright) side.brightRows++;
    if (record.gaiaSourceId === null) side.rowsWithoutSourceId++;
    if (record.gaiaSourceId === null || !overlay.has(record.gaiaSourceId)) {
      side.rowsWithoutOverlayEntry++;
      if (isBright) side.brightRowsWithoutOverlayEntry++;
    }
  }
  return side;
}

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

function reportCoverage(counts: ClassicIdOverlayCounts): void {
  console.log(
    `spine label parity over ${counts.spineRows} rows: ` +
      `${counts.spineRowsWithoutOverlayEntry} have no overlay entry at all ` +
      `(${counts.spineRowsWithoutSourceId} carry no source_id; the rest resolve ` +
      `to one absent from both cross-walks), including ` +
      `${counts.spineBrightRowsWithoutOverlayEntry} of ${counts.spineBrightRows} ` +
      `rows at V <= ${BRIGHT_TIER_MAG_CEILING}. Those labels ride the ` +
      `inherited spine, not the overlay.`,
  );
  for (const field of LABEL_FIELDS) {
    const covered = counts.labelAgree[field];
    const keyed = covered + counts.labelFlipped[field] + counts.labelSpineOnly[field];
    const pct = keyed === 0 ? 0 : (100 * covered) / keyed;
    console.log(
      `  ${field.padEnd(6)} ${String(covered).padStart(7)} / ${String(keyed).padStart(7)}` +
        ` (${pct.toFixed(1)}%) — added ${counts.labelAdded[field]}, ` +
        `flipped ${counts.labelFlipped[field]}, ` +
        `suppressed ${counts.labelSuppressed[field]}, ` +
        `extras dropped ${counts.labelExtraDropped[field]}, ` +
        `overridden ${counts.labelOverridden[field]}`,
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
  const crossIndex = parseCrossIndexTsv(readRequired(SRC_CROSS_INDEX, CDS_HINT));
  const bsc5 = parseBsc5Tsv(readRequired(SRC_BSC5, CDS_HINT));

  // Both best-neighbour walks below are unvetted, so the gate's evidence is a
  // required input, not an enrichment: without it the join would key labels on
  // sources the record build refuses. Hard-fail rather than degrade.
  const gaiaAstrometry = parseGaiaAstrometryCatalogTsv(
    readRequired(SRC_GAIA_ASTROMETRY, ASTROMETRY_HINT),
  );
  const { vmag: hipVMag } = parseHipPhotometryTsv(readRequired(SRC_HIP_VMAG, HIP_VMAG_HINT));
  const wdsXids: SimbadWdsXidIndex = parseSimbadWdsXidsTsv(
    readRequired(SRC_SIMBAD_WDS_XIDS, SIMBAD_HINT),
  );
  const sourceGMag = new Map<string, number>();
  for (const [sourceId, row] of gaiaAstrometry) {
    if (row.gMag !== null) sourceGMag.set(sourceId, row.gMag);
  }
  const evidence = bindingEvidence(sourceGMag, hipVMag, wdsXids, gaiaAstrometry);

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

  // The merge runs here as well as in the record build, over the same overlay
  // and the same pure function, so the committed review queue below describes
  // exactly the labels build:catalog writes. Its own count snapshot is the
  // cross-check.
  const spine = readSpineLabelSide(overlay);
  const overrides = existsSync(SRC_OVERRIDES)
    ? parseLabelOverridesTsv(readFileSync(SRC_OVERRIDES, 'utf8'))
    : new Map();
  const merge = mergeClassicIdLabels({
    records: spine.records,
    labels: spine.labels,
    overlay,
    overrides,
  });

  const counts: ClassicIdOverlayCounts = {
    ...joinCounts,
    ...merge.counts,
    spineRows: spine.rows,
    spineRowsWithoutSourceId: spine.rowsWithoutSourceId,
    spineRowsWithoutOverlayEntry: spine.rowsWithoutOverlayEntry,
    spineBrightRows: spine.brightRows,
    spineBrightRowsWithoutOverlayEntry: spine.brightRowsWithoutOverlayEntry,
  };

  writeFileSync(OUT_OVERLAY, serializeOverlay(overlay));
  writeDisagreements(disagreements);
  writeRejectedBindings(rejectedBindings);
  writeFileSync(OUT_LABEL_FLIPS, labelFlipsTsv(merge.flips));
  logOverlay(overlay, counts);
  reportCoverage(counts);
  console.log(`wrote ${OUT_OVERLAY}`);
  console.log(`wrote ${OUT_DISAGREEMENTS} (${disagreements.length} rows)`);
  console.log(`wrote ${OUT_REJECTED} (${rejectedBindings.length} rows)`);
  console.log(`wrote ${OUT_LABEL_FLIPS} (${merge.flips.length} rows)`);

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
