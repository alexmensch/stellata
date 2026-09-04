// `pnpm run audit:spine-primaries` — measure the inherited spine against the
// frozen primary tables AT-HYG merged. Prints the report; --out=<dir> also
// writes the residual, partial, disagreement and addition rows as TSVs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT, readRequired } from '../../util/paths';
import { dataRows, parseIntOrNull } from '../parse/corpus-tsv';
import { readGaiaHipXmatch, readGaiaTycXmatch } from '../parse/gaia-xmatch';
import {
  SRC_CNS5, SRC_HIP_XMATCH, SRC_TYC2_HD, SRC_TYC_XMATCH,
} from '../classic-ids/binding-candidates';
import {
  parseBsc5Tsv, parseCns5Tsv, parseCrossIndexTsv, parseTyc2HdTsv,
} from '../classic-ids/classic-ids-parse';
import { parseGlieseTsv } from '../gliese-parse';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { INHERITED_SPINE_FILE, SPINE_COLUMNS, parseSpineTsv } from './inherited-spine-pure';
import {
  auditSpine, formatAuditReport, type PrimaryTables, type SimbadXids, type WgsnKeys,
} from './primaries-audit-pure';

const SRC_BSC5 = resolve(ROOT, 'data/classic-ids/bsc5.tsv');
const SRC_CROSS_INDEX = resolve(ROOT, 'data/classic-ids/cross_index.tsv');
const SRC_GLIESE = resolve(ROOT, 'data/gliese/gliese_v70a.tsv');
const SRC_HIP_MAIN = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
const SRC_TYCHO2_MAIN = resolve(ROOT, 'data/tycho2/tycho2_main.tsv');
const SRC_TYCHO2_SUPPL1 = resolve(ROOT, 'data/tycho2/tycho2_suppl1.tsv');
const SRC_WGSN_NAMES = resolve(ROOT, 'data/iau-wgsn/wgsn_names.tsv');
const SRC_WGSN_DESIGNATIONS = resolve(ROOT, 'data/iau-wgsn/wgsn_designations.tsv');
const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');

const LFS_HINT = 'run `git lfs pull`.';

function readHipI239(): Set<number> {
  const hips = new Set<number>();
  for (const { cells, idx } of dataRows(
    readRequired(SRC_HIP_MAIN, 'run `pnpm run refresh:hip-vmag`.'), ['hip'], 'hip_main_vmag.tsv', '',
  )) {
    const hip = parseIntOrNull(cells[idx.hip]);
    if (hip !== null) hips.add(hip);
  }
  return hips;
}

function readWgsn(): WgsnKeys {
  const names = new Set<string>();
  const hd = new Set<number>();
  const hip = new Set<number>();
  const hint = 'run `pnpm run build:wgsn`.';
  for (const { cells, idx } of dataRows(
    readRequired(SRC_WGSN_NAMES, hint), ['name', 'aliases', 'hip', 'hd'], 'wgsn_names.tsv', hint,
  )) {
    if (cells[idx.name]) names.add(cells[idx.name]);
    for (const alias of (cells[idx.aliases] ?? '').split('|')) if (alias) names.add(alias);
    const h = parseIntOrNull(cells[idx.hip]);
    const d = parseIntOrNull(cells[idx.hd]);
    if (h !== null) hip.add(h);
    if (d !== null) hd.add(d);
  }
  for (const { cells, idx } of dataRows(
    readRequired(SRC_WGSN_DESIGNATIONS, hint), ['hip', 'hd'], 'wgsn_designations.tsv', hint,
  )) {
    const h = parseIntOrNull(cells[idx.hip]);
    const d = parseIntOrNull(cells[idx.hd]);
    if (h !== null) hip.add(h);
    if (d !== null) hd.add(d);
  }
  return { names, hd, hip };
}

function readSimbadXids(): Map<string, SimbadXids> {
  const out = new Map<string, SimbadXids>();
  for (const { cells, idx } of dataRows(
    readRequired(SRC_SIMBAD_SPTYPE, LFS_HINT), ['source_id', 'hip', 'tyc', 'gj'], 'simbad_sptype.tsv', LFS_HINT,
  )) {
    const sourceId = cells[idx.source_id];
    if (!sourceId || out.has(sourceId)) continue;
    out.set(sourceId, {
      hip: parseIntOrNull(cells[idx.hip]),
      tyc: cells[idx.tyc] || null,
      gj: cells[idx.gj] || null,
    });
  }
  return out;
}

function tsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
}

async function main(): Promise<void> {
  const outDir = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? null;

  const spine = parseSpineTsv(readRequired(resolve(ROOT, INHERITED_SPINE_FILE), LFS_HINT));
  const iv25 = parseTyc2HdTsv(readRequired(SRC_TYC2_HD, LFS_HINT));
  const keep = new Set<string>(iv25.map((r) => r.tyc));
  for (const row of spine) if (row.tyc !== '') keep.add(row.tyc);

  const tables: PrimaryTables = {
    iv25,
    v50: parseBsc5Tsv(readRequired(SRC_BSC5, LFS_HINT)),
    iv27a: parseCrossIndexTsv(readRequired(SRC_CROSS_INDEX, LFS_HINT)),
    cns5: parseCns5Tsv(readRequired(SRC_CNS5, LFS_HINT)),
    gliese: parseGlieseTsv(readRequired(SRC_GLIESE, LFS_HINT)),
    hipI239: readHipI239(),
    wgsn: readWgsn(),
    tycho2: parseTycho2Tsvs(
      readRequired(SRC_TYCHO2_MAIN, LFS_HINT), readRequired(SRC_TYCHO2_SUPPL1, LFS_HINT),
    ),
    tycToSource: await readGaiaTycXmatch(SRC_TYC_XMATCH, keep),
    hipToSource: readGaiaHipXmatch(SRC_HIP_XMATCH),
    simbadBySourceId: readSimbadXids(),
  };

  const result = auditSpine(spine, tables);
  console.log(formatAuditReport(result.summary));

  if (outDir === null) return;
  mkdirSync(outDir, { recursive: true });
  const idCols = ['tyc', 'hip', 'hd', 'hr', 'gl', 'flam', 'bayer', 'proper', 'gaia_source_id'] as const;
  const idCells = (row: Record<typeof SPINE_COLUMNS[number], string>) => idCols.map((c) => row[c]);
  writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(result.summary, null, 2) + '\n');
  writeFileSync(resolve(outDir, 'residual.tsv'), tsv(
    [...idCols, 'unattested'],
    result.residualRows.map((r) => [...idCells(r.row), r.unattested.join('|')]),
  ));
  writeFileSync(resolve(outDir, 'partial.tsv'), tsv(
    [...idCols, 'unattested'],
    result.partialRows.map((r) => [...idCells(r.row), r.unattested.join('|')]),
  ));
  writeFileSync(resolve(outDir, 'identity_unreproduced.tsv'), tsv(
    [...idCols, 'verdict', 'via_tyc', 'via_hip', 'via_cns5', 'simbad', 'gaia_keyed'],
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
  writeFileSync(resolve(outDir, 'additions_hip.tsv'), tsv(
    ['hip', 'gaia_source_id'],
    result.additions.hip.map((h) => [String(h.hip), h.gaiaSourceId ?? '']),
  ));
  writeFileSync(resolve(outDir, 'additions_cns5.tsv'), tsv(
    ['cns5', 'gj', 'gj_comp', 'gaia_source_id', 'hip'],
    result.additions.cns5.newRecords.map((r) => [
      String(r.cns5), r.gj, r.gjComp ?? '', r.gaiaSourceId ?? '', r.hip === null ? '' : String(r.hip),
    ]),
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
