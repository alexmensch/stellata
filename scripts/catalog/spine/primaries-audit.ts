// `pnpm run audit:spine-primaries` — measure the inherited spine against the
// frozen primary tables AT-HYG merged. Prints the report; --out=<dir> also
// writes the row behind every count it prints.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { splitCsvLine } from '../naming/wgsn-parse-pure';
import { INHERITED_SPINE_FILE, parseSpineTsv, type SpineRow } from './inherited-spine-pure';
import {
  CLASSICAL_CELLS, auditSpine, formatAuditReport, tallyAthygHdProvenance,
  type AthygHdProvenance, type RowSink,
} from './primaries-audit-pure';
import { LFS_HINT, loadPrimaryTables } from './primaries-tables';

const SRC_ATHYG_CSV = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');

/** Rows buffered before the per-row attestation file is appended to. */
const ATTESTATION_FLUSH_ROWS = 50_000;

function* athygHdRows(): Generator<{ hd: string; hyg: string }> {
  const lines = readRequired(SRC_ATHYG_CSV, LFS_HINT).split('\n');
  const header = splitCsvLine(lines[0]);
  const iHd = header.indexOf('hd');
  const iHyg = header.indexOf('hyg');
  if (iHd < 0 || iHyg < 0) {
    throw new Error(`athyg_33_classic_ids.csv: no hd / hyg column; ${LFS_HINT}`);
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const cells = splitCsvLine(lines[i]);
    yield { hd: cells[iHd] ?? '', hyg: cells[iHyg] ?? '' };
  }
}

/** Tabs and newlines would silently re-shape the row they are written into. */
function cell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ');
}

function tsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((r) => r.map(cell).join('\t')).join('\n') + '\n';
}

const ID_COLS = [
  'tyc', 'hip', 'hd', 'hr', 'gl', 'flam', 'bayer', 'proper', 'gaia_source_id',
] as const;

function idCells(row: SpineRow): string[] {
  return ID_COLS.map((c) => row[c]);
}

/** Streams the per-row attestation so every `attested by` count has its rows on
 *  disk without holding one object per spine row in memory. */
function attestationWriter(path: string): { onRow: RowSink; close: () => void } {
  writeFileSync(path, tsv([
    ...ID_COLS, 'residual', 'carried', 'unattested',
    ...CLASSICAL_CELLS.map((c) => `by_${c}`), 'verdict', 'simbad',
  ], []));
  let buffered: string[] = [];
  const flush = (): void => {
    if (buffered.length === 0) return;
    appendFileSync(path, buffered.join(''));
    buffered = [];
  };
  return {
    onRow: (row, attestation, identity) => {
      buffered.push([
        ...idCells(row),
        attestation.residual ? '1' : '0',
        attestation.carried.join('|'),
        attestation.unattested.join('|'),
        ...CLASSICAL_CELLS.map((c) => attestation.attestation[c] ?? ''),
        identity.verdict,
        identity.simbad ?? '',
      ].map(cell).join('\t') + '\n');
      if (buffered.length >= ATTESTATION_FLUSH_ROWS) flush();
    },
    close: flush,
  };
}

async function main(): Promise<void> {
  const outDir = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? null;

  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const tables = await loadPrimaryTables(spine.map((r) => r.tyc).filter((t) => t !== ''));
  const athygHd: AthygHdProvenance = tallyAthygHdProvenance(athygHdRows());

  if (outDir !== null) mkdirSync(outDir, { recursive: true });
  const attestation = outDir === null
    ? null
    : attestationWriter(resolve(outDir, 'attestation.tsv'));
  const result = auditSpine(spine, tables, athygHd, attestation?.onRow);
  attestation?.close();
  console.log(formatAuditReport(result.summary));

  if (outDir === null) return;
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(result.summary, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'residual.tsv'), tsv(
    [...ID_COLS, 'unattested'],
    result.residualRows.map((r) => [...idCells(r.row), r.unattested.join('|')]),
  ));
  writeFileSync(resolve(outDir, 'partial.tsv'), tsv(
    [...ID_COLS, 'unattested'],
    result.partialRows.map((r) => [...idCells(r.row), r.unattested.join('|')]),
  ));
  writeFileSync(resolve(outDir, 'identity_unreproduced.tsv'), tsv(
    [...ID_COLS, 'verdict', 'via_tyc', 'via_hip', 'via_cns5', 'simbad', 'gaia_keyed'],
    result.unreproduced.map((d) => [
      ...idCells(d.row), d.check.verdict, d.check.viaTyc ?? '', d.check.viaHip ?? '',
      d.check.viaCns5 ?? '', d.check.simbad ?? '', d.check.gaiaKeyed ? '1' : '0',
    ]),
  ));
  writeFileSync(resolve(outDir, 'additions_hd.tsv'), tsv(
    ['tyc', 'hd', 'ambiguous', 'vt_mag', 'in_tycho2', 'gaia_source_id'],
    result.additions.hd.map((a) => [
      a.tyc, a.hds.join('|'), a.ambiguous ? '1' : '0', a.vtMag === null ? '' : String(a.vtMag),
      a.inTycho2 ? '1' : '0', a.gaiaSourceId ?? '',
    ]),
  ));
  writeFileSync(resolve(outDir, 'additions_hd_on_existing.tsv'), tsv(
    ['tyc', 'hd'],
    result.additions.hdOnExistingRecord.map((a) => [a.tyc, a.hds.join('|')]),
  ));
  writeFileSync(resolve(outDir, 'additions_hip.tsv'), tsv(
    ['hip', 'gaia_source_id', 'in_hip2', 'in_tycho2'],
    result.additions.hip.map((h) => [
      String(h.hip), h.gaiaSourceId ?? '', h.inHip2 ? '1' : '0', h.inTycho2 ? '1' : '0',
    ]),
  ));
  const cns5Cells = (r: { cns5: number; gj: string; gjComp: string | null;
    gaiaSourceId: string | null; hip: number | null }): string[] => [
    String(r.cns5), r.gj, r.gjComp ?? '', r.gaiaSourceId ?? '', r.hip === null ? '' : String(r.hip),
  ];
  const cns5Header = ['cns5', 'gj', 'gj_comp', 'gaia_source_id', 'hip'];
  writeFileSync(resolve(outDir, 'additions_cns5.tsv'), tsv(
    cns5Header, result.additions.cns5.newRecords.map(cns5Cells),
  ));
  writeFileSync(resolve(outDir, 'additions_cns5_on_existing.tsv'), tsv(
    cns5Header, result.additions.cns5.onExistingRecord.map(cns5Cells),
  ));
  writeFileSync(resolve(outDir, 'additions_iv27a.tsv'), tsv(
    ['hd', 'hip', 'bayer', 'flamsteed', 'cst'],
    result.additions.iv27a.map((r) => [
      String(r.hd), r.hip === null ? '' : String(r.hip), r.bayer ?? '',
      r.flamsteed === null ? '' : String(r.flamsteed), r.cst ?? '',
    ]),
  ));
  writeFileSync(resolve(outDir, 'additions_v50.tsv'), tsv(
    ['hr', 'hd', 'name'],
    result.additions.v50.map((r) => [String(r.hr), r.hd === null ? '' : String(r.hd), r.name ?? '']),
  ));
  console.log(`wrote ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
