// Builds the keyed WGSN name + designation tables from the frozen IAU
// files, unions the IV/27A Bayer tail, verifies the AT-HYG proper
// dispositions, and pins the counts. `pnpm run build:wgsn`. See README.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseCrossIndexTsv } from '../classic-ids/classic-ids-parse';
import { REPO_ROOT } from '../../util/paths';
import { assertOrUpdateSnapshot } from '../../util/snapshot-assert';
import { compareBuildCounts, formatCountDiff } from '../build-counts';
import {
  parseNecCsv,
  parseWgsnFaintsCsv,
  type WgsnRow,
} from './wgsn-parse-pure';
import {
  foldNameKey,
  normaliseIv27aBayer,
  normaliseWgsnCell,
  splitNameCell,
  type NormalisedCell,
} from './wgsn-normalise-pure';

const DATA = resolve(REPO_ROOT, 'data/iau-wgsn');
const NEC_CSV = resolve(DATA, 'NEC.csv');
const FAINTS_CSV = resolve(DATA, 'wgsnFaints.csv');
const DISPOSITIONS = resolve(DATA, 'athyg_proper_dispositions.tsv');
const OUT_NAMES = resolve(DATA, 'wgsn_names.tsv');
const OUT_DESIGNATIONS = resolve(DATA, 'wgsn_designations.tsv');
const CROSS_INDEX = resolve(REPO_ROOT, 'data/classic-ids/cross_index.tsv');
const SPINE = resolve(REPO_ROOT, 'data/athyg/inherited-spine.tsv');
const SNAPSHOT = resolve(REPO_ROOT, 'scripts/catalog/naming/wgsn-expected.json');

export interface WgsnCounts {
  necRows: number;
  faintsRows: number;
  namedRows: number;
  nameRowsWithAliases: number;
  distinctNameKeys: number;
  namesKeyless: number;
  cellBayer: number;
  cellFlamsteed: number;
  cellGould: number;
  cellVariable: number;
  cellNonStellar: number;
  cellOtherCatalogue: number;
  cellCorrupt: number;
  cellEmpty: number;
  iv27aBayerCells: number;
  iv27aBayerAdded: number;
  iv27aBayerCovered: number;
  iv27aVariableRejected: number;
  iv27aUnparsed: number;
  designationRows: number;
  spinePropers: number;
  spineProperMatched: number;
  spineProperResiduals: number;
  spineBayerRows: number;
  spineBayerRowsCovered: number;
}

const cellStr = (v: string | number | null): string =>
  v === null ? '' : String(v);

interface DesignationRow {
  kind: 'bayer' | 'flamsteed' | 'gould';
  letter: string | null;
  sup: number | null;
  num: number | null;
  dc: string;
  half: string | null;
  component: string | null;
  hip: number | null;
  hr: number | null;
  hd: number | null;
  source: 'nec' | 'faints' | 'iv27a';
}

function designationFromCell(
  n: NormalisedCell,
  row: WgsnRow,
): DesignationRow | null {
  if (n.class === 'bayer') {
    return {
      kind: 'bayer', letter: n.bayer.letter, sup: n.bayer.sup, num: null,
      dc: n.bayer.dc, half: null, component: n.bayer.component,
      hip: row.hip, hr: row.hr, hd: row.hd, source: row.source,
    };
  }
  if (n.class === 'flamsteed') {
    return {
      kind: 'flamsteed', letter: null, sup: null, num: n.flamsteed.num,
      dc: n.flamsteed.dc, half: null, component: n.flamsteed.component,
      hip: row.hip, hr: row.hr, hd: row.hd, source: row.source,
    };
  }
  if (n.class === 'gould') {
    return {
      kind: 'gould', letter: null, sup: null, num: n.gould.num,
      dc: n.gould.dc, half: n.gould.serpensHalf,
      component: n.gould.component,
      hip: row.hip, hr: row.hr, hd: row.hd, source: row.source,
    };
  }
  return null;
}

interface SpineNaming {
  /** proper-row key ("<proper>|<hip>|<hd>") → the raw proper string. */
  propers: Map<string, string>;
  bayerKeys: { hip: number | null; hd: number | null }[];
}

function readSpine(): SpineNaming {
  const lines = readFileSync(SPINE, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`inherited-spine.tsv is missing '${name}'`);
    return i;
  };
  const properIdx = col('proper');
  const bayerIdx = col('bayer');
  const hipIdx = col('hip');
  const hdIdx = col('hd');
  const propers = new Map<string, string>();
  const bayerKeys: { hip: number | null; hd: number | null }[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split('\t');
    const hip = cells[hipIdx]?.trim() ?? '';
    const hd = cells[hdIdx]?.trim() ?? '';
    const proper = (cells[properIdx] ?? '').trim();
    if (proper && proper !== 'Sol') {
      propers.set([proper, hip, hd].join('|'), proper);
    }
    if ((cells[bayerIdx] ?? '').trim()) {
      bayerKeys.push({
        hip: hip === '' ? null : Number(hip),
        hd: hd === '' ? null : Number(hd),
      });
    }
  }
  return { propers, bayerKeys };
}

function main(): void {
  const nec = parseNecCsv(readFileSync(NEC_CSV, 'utf8'));
  const faints = parseWgsnFaintsCsv(readFileSync(FAINTS_CSV, 'utf8'));
  const rows = [...nec, ...faints];

  const classCounts = new Map<string, number>();
  const designations: DesignationRow[] = [];
  const nameLines: string[] = [];
  const nameKeys = new Set<string>();
  let namedRows = 0;
  let nameRowsWithAliases = 0;
  let namesKeyless = 0;

  for (const row of rows) {
    const n = normaliseWgsnCell(row.bayerOther);
    classCounts.set(n.class, (classCounts.get(n.class) ?? 0) + 1);
    const d = designationFromCell(n, row);
    if (d !== null) designations.push(d);

    if (row.name !== null) {
      namedRows++;
      const { name, aliases } = splitNameCell(row.name);
      if (aliases.length > 0) nameRowsWithAliases++;
      for (const k of [name, ...aliases]) nameKeys.add(foldNameKey(k));
      if (row.hip === null && row.hr === null && row.hd === null) namesKeyless++;
      nameLines.push([
        name, aliases.join('|'), cellStr(row.hip), cellStr(row.hr),
        cellStr(row.hd), cellStr(row.hdComponent), cellStr(row.wds),
        cellStr(row.vmag), row.source, row.id,
      ].join('\t'));
    }
  }

  // IV/27A Bayer tail: rows whose star no WGSN Bayer designation reaches.
  const wgsnBayerHds = new Set(
    designations.filter((d) => d.kind === 'bayer' && d.hd !== null).map((d) => d.hd),
  );
  const wgsnBayerHips = new Set(
    designations.filter((d) => d.kind === 'bayer' && d.hip !== null).map((d) => d.hip),
  );
  let iv27aBayerCells = 0;
  let iv27aBayerAdded = 0;
  let iv27aBayerCovered = 0;
  let iv27aVariableRejected = 0;
  let iv27aUnparsed = 0;
  for (const row of parseCrossIndexTsv(readFileSync(CROSS_INDEX, 'utf8'))) {
    if (row.bayer === null || row.cst === null) continue;
    iv27aBayerCells++;
    const n = normaliseIv27aBayer(row.bayer, row.cst);
    if (n.class === 'variable') { iv27aVariableRejected++; continue; }
    if (n.class !== 'bayer') { iv27aUnparsed++; continue; }
    if (wgsnBayerHds.has(row.hd) || (row.hip !== null && wgsnBayerHips.has(row.hip))) {
      iv27aBayerCovered++;
      continue;
    }
    iv27aBayerAdded++;
    designations.push({
      kind: 'bayer', letter: n.bayer.letter, sup: n.bayer.sup, num: null,
      dc: row.cst, half: null, component: null,
      hip: row.hip, hr: null, hd: row.hd, source: 'iv27a',
    });
  }

  // § 2 residuals: every spine proper either matches a WGSN name key or
  // appears in the committed dispositions file — exact set equality, the
  // route-disagreements review-join discipline.
  const spine = readSpine();
  const unmatched = new Set<string>();
  let matched = 0;
  for (const [key, proper] of spine.propers) {
    if (nameKeys.has(foldNameKey(proper))) matched++;
    else unmatched.add(key);
  }
  const dispositionLines = readFileSync(DISPOSITIONS, 'utf8')
    .split('\n').filter((l) => l.trim() !== '');
  const disposed = new Set<string>();
  for (const line of dispositionLines.slice(1)) {
    const [proper, , hip = '', hd = ''] = line.split('\t');
    disposed.add([proper, hip, hd].join('|'));
  }
  const missing = [...unmatched].filter((k) => !disposed.has(k));
  const stale = [...disposed].filter((k) => !unmatched.has(k));
  if (missing.length > 0 || stale.length > 0) {
    for (const k of missing) console.error(`undisposed spine proper: ${k}`);
    for (const k of stale) {
      console.error(`stale disposition (now matches WGSN or left the spine): ${k}`);
    }
    console.error(
      '\ndata/iau-wgsn/athyg_proper_dispositions.tsv must enumerate exactly '
      + 'the spine propers no WGSN name matches (docs/star-naming.md § 2).',
    );
    process.exit(1);
  }

  // Coverage of the spine's own Bayer-bearing rows, the § 9 sequencing
  // measurement (1,494 of 1,522 at the gate).
  const desigHds = new Set(
    designations.filter((d) => d.kind === 'bayer' && d.hd !== null).map((d) => d.hd),
  );
  const desigHips = new Set(
    designations.filter((d) => d.kind === 'bayer' && d.hip !== null).map((d) => d.hip),
  );
  const spineBayerRowsCovered = spine.bayerKeys.filter(
    (k) => (k.hd !== null && desigHds.has(k.hd))
      || (k.hip !== null && desigHips.has(k.hip)),
  ).length;

  const sortKey = (d: DesignationRow) => [
    d.kind, d.dc, String(d.num ?? '').padStart(4, '0'), d.letter ?? '',
    String(d.sup ?? ''), d.half ?? '', d.component ?? '', String(d.hd ?? ''),
  ].join(' ');
  designations.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

  writeFileSync(OUT_NAMES, [
    'name\taliases\thip\thr\thd\thd_component\twds\tvmag\tsource\tsrc_id',
    ...nameLines,
  ].join('\n') + '\n');
  writeFileSync(OUT_DESIGNATIONS, [
    'kind\tletter\tsup\tnum\tdc\thalf\tcomponent\thip\thr\thd\tsource',
    ...designations.map((d) => [
      d.kind, cellStr(d.letter), cellStr(d.sup), cellStr(d.num), d.dc,
      cellStr(d.half), cellStr(d.component), cellStr(d.hip), cellStr(d.hr),
      cellStr(d.hd), d.source,
    ].join('\t')),
  ].join('\n') + '\n');

  const counts: WgsnCounts = {
    necRows: nec.length,
    faintsRows: faints.length,
    namedRows,
    nameRowsWithAliases,
    distinctNameKeys: nameKeys.size,
    namesKeyless,
    cellBayer: classCounts.get('bayer') ?? 0,
    cellFlamsteed: classCounts.get('flamsteed') ?? 0,
    cellGould: classCounts.get('gould') ?? 0,
    cellVariable: classCounts.get('variable') ?? 0,
    cellNonStellar: classCounts.get('non_stellar') ?? 0,
    cellOtherCatalogue: classCounts.get('other_catalogue') ?? 0,
    cellCorrupt: classCounts.get('corrupt') ?? 0,
    cellEmpty: classCounts.get('empty') ?? 0,
    iv27aBayerCells,
    iv27aBayerAdded,
    iv27aBayerCovered,
    iv27aVariableRejected,
    iv27aUnparsed,
    designationRows: designations.length,
    spinePropers: spine.propers.size,
    spineProperMatched: matched,
    spineProperResiduals: unmatched.size,
    spineBayerRows: spine.bayerKeys.length,
    spineBayerRowsCovered,
  };

  console.log(`wgsn_names.tsv: ${nameLines.length} rows`);
  console.log(`wgsn_designations.tsv: ${designations.length} rows`);
  void assertOrUpdateSnapshot<WgsnCounts>({
    envVar: 'UPDATE_BUILD_COUNTS',
    snapshotPath: SNAPSHOT,
    actual: counts,
    compare: (expected, actual) => {
      const diff = compareBuildCounts(expected, actual);
      return {
        drifted: diff.some((d) => d.status === 'mismatch'),
        report: formatCountDiff(diff),
      };
    },
    failureLabel: 'WGSN table counts',
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:wgsn',
  });
}

main();
