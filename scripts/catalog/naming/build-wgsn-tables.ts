// Builds the keyed WGSN name + designation tables from the frozen IAU
// files, unions the IV/27A Bayer tail, verifies the AT-HYG proper
// dispositions, and pins the counts. `pnpm run build:wgsn`. See README.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseCrossIndexTsv } from '../classic-ids/classic-ids-parse';
import { parseIntOrNull } from '../parse/stars-parse';
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
  hipComponentCells: number;
  hdComponentCells: number;
  faintsWdsCells: number;
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
  designationsKeyless: number;
  designationDuplicateRows: number;
  nameDuplicateRows: number;
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

type DesignationKeys = Pick<DesignationRow, 'hip' | 'hr' | 'hd' | 'source'>;

function designationRow(
  kind: DesignationRow['kind'],
  designation: Partial<DesignationRow>,
  keys: DesignationKeys,
): DesignationRow {
  return {
    kind,
    letter: null, sup: null, num: null, half: null, component: null,
    dc: '', ...designation, ...keys,
  };
}

/** Which stars the Bayer designations already reach, by either key. Built
 *  once before the IV/27A union to decide what the tail adds, and again
 *  after it to measure spine coverage. */
function bayerKeySets(rows: DesignationRow[]): {
  reaches: (hip: number | null, hd: number | null) => boolean;
} {
  const hips = new Set<number>();
  const hds = new Set<number>();
  for (const d of rows) {
    if (d.kind !== 'bayer') continue;
    if (d.hip !== null) hips.add(d.hip);
    if (d.hd !== null) hds.add(d.hd);
  }
  return {
    reaches: (hip, hd) =>
      (hd !== null && hds.has(hd)) || (hip !== null && hips.has(hip)),
  };
}

function designationFromCell(
  n: NormalisedCell,
  row: WgsnRow,
): DesignationRow | null {
  const keys: DesignationKeys = {
    hip: row.hip, hr: row.hr, hd: row.hd, source: row.source,
  };
  if (n.class === 'bayer') return designationRow('bayer', n.bayer, keys);
  if (n.class === 'flamsteed') {
    return designationRow('flamsteed', n.flamsteed, keys);
  }
  if (n.class === 'gould') {
    const { serpensHalf, ...gould } = n.gould;
    return designationRow('gould', { ...gould, half: serpensHalf }, keys);
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
      bayerKeys.push({ hip: parseIntOrNull(hip), hd: parseIntOrNull(hd) });
    }
  }
  return { propers, bayerKeys };
}

async function main(): Promise<void> {
  const nec = parseNecCsv(readFileSync(NEC_CSV, 'utf8'));
  const faints = parseWgsnFaintsCsv(readFileSync(FAINTS_CSV, 'utf8'));
  const rows = [...nec, ...faints];

  const classCounts = new Map<string, number>();
  const designations: DesignationRow[] = [];
  const nameLines: string[] = [];
  const nameKeys = new Set<string>();
  const nameRowKeys: string[] = [];
  let namedRows = 0;
  let nameRowsWithAliases = 0;
  let namesKeyless = 0;

  const hipComponentCells = rows.filter((r) => r.hipComponent !== null).length;
  const hdComponentCells = rows.filter((r) => r.hdComponent !== null).length;
  const faintsWdsCells = rows.filter((r) => r.wds !== null).length;

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
      nameRowKeys.push(
        [foldNameKey(name), row.hip, row.hr, row.hd].join('|'),
      );
      if (row.hip === null && row.hr === null && row.hd === null) namesKeyless++;
      nameLines.push([
        name, aliases.join('|'), cellStr(row.hip), cellStr(row.hipComponent),
        cellStr(row.hr), cellStr(row.hd), cellStr(row.hdComponent),
        cellStr(row.vmag), row.source, row.id,
      ].join('\t'));
    }
  }

  const wgsnBayer = bayerKeySets(designations);
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
    if (wgsnBayer.reaches(row.hip, row.hd)) {
      iv27aBayerCovered++;
      continue;
    }
    iv27aBayerAdded++;
    designations.push(designationRow(
      'bayer',
      { ...n.bayer, dc: row.cst, component: null },
      { hip: row.hip, hr: null, hd: row.hd, source: 'iv27a' },
    ));
  }

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

  const unioned = bayerKeySets(designations);
  const spineBayerRowsCovered = spine.bayerKeys.filter(
    (k) => unioned.reaches(k.hip, k.hd),
  ).length;

  // Every field participates: a comparator that ties leaves the committed
  // row order to the engine's sort, and CI diffs these files byte for byte.
  const sortKey = (d: DesignationRow) => [
    d.kind, d.dc, String(d.num ?? '').padStart(4, '0'), d.letter ?? '',
    String(d.sup ?? ''), d.half ?? '', d.component ?? '', String(d.hd ?? ''),
    String(d.hip ?? ''), String(d.hr ?? ''), d.source,
  ].join(' ');
  const keyed = designations.map((d) => ({ key: sortKey(d), d }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const sorted = keyed.map((k) => k.d);

  writeFileSync(OUT_NAMES, [
    'name\taliases\thip\thip_component\thr\thd\thd_component\tvmag\tsource\tsrc_id',
    ...nameLines,
  ].join('\n') + '\n');
  writeFileSync(OUT_DESIGNATIONS, [
    'kind\tletter\tsup\tnum\tdc\thalf\tcomponent\thip\thr\thd\tsource',
    ...sorted.map((d) => [
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
    hipComponentCells,
    hdComponentCells,
    faintsWdsCells,
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
    designationRows: sorted.length,
    designationsKeyless: sorted.filter(
      (d) => d.hip === null && d.hr === null && d.hd === null,
    ).length,
    designationDuplicateRows: sorted.length - new Set(keyed.map((k) => k.key)).size,
    nameDuplicateRows: nameRowKeys.length - new Set(nameRowKeys).size,
    spinePropers: spine.propers.size,
    spineProperMatched: matched,
    spineProperResiduals: unmatched.size,
    spineBayerRows: spine.bayerKeys.length,
    spineBayerRowsCovered,
  };

  console.log(`wgsn_names.tsv: ${nameLines.length} rows`);
  console.log(`wgsn_designations.tsv: ${designations.length} rows`);
  await assertOrUpdateSnapshot<WgsnCounts>({
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
