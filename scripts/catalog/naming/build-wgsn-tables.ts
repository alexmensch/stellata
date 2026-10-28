// Builds the keyed WGSN name + designation tables from the frozen IAU
// files, unions the IV/27A Bayer tail, verifies the AT-HYG proper
// dispositions, and pins the counts. `pnpm run build:wgsn`. See README.md.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readCrossIndexTable } from '../classic-ids/cross-index';
import { MEMBERSHIP_MANIFEST, MEMBERSHIP_MANIFEST_FILE } from '../membership/membership-manifest-tsv';
import { REPO_ROOT } from '../../util/paths';
import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import { snapshotCheck } from '../../util/snapshot-check';
import { compareCountSnapshot } from '../build-counts';
import {
  FAINTS_CORRECTIONS, parseFaintsCorrections, parseNecCsv, parseWgsnFaintsCsv,
} from './wgsn-parse-pure';
import {
  foldNameKey,
  normaliseWgsnCell,
  splitNameCell,
} from './wgsn-normalise-pure';
import {
  bayerKeySets,
  designationFromCell,
  diffDispositions,
  duplicateDesignationRows,
  membershipProperKey,
  unionIv27aBayer,
  type DesignationRow,
} from './wgsn-tables-pure';
import { PROPER_DISPOSITIONS_TABLE, parseProperDispositions, type WgsnNameRow } from './wgsn-index-pure';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';
import { WGSN_OUTPUTS } from './wgsn-tables-outputs';

const DATA = resolve(REPO_ROOT, 'data/iau-wgsn');
const NEC_CSV = resolve(DATA, 'NEC.csv');
const FAINTS_CSV = resolve(DATA, 'wgsnFaints.csv');
const FAINTS_CORRECTIONS_TSV = resolve(REPO_ROOT, FAINTS_CORRECTIONS.file);
const DISPOSITIONS = resolve(REPO_ROOT, PROPER_DISPOSITIONS_TABLE.file);
const MANIFEST = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
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
  membershipPropers: number;
  membershipProperMatched: number;
  membershipProperResiduals: number;
  membershipBayerRows: number;
  membershipBayerRowsCovered: number;
}

interface MembershipNaming {
  /** proper-row key ("<proper>|<hip>|<hd>") → the raw proper string. */
  propers: Map<string, string>;
  bayerKeys: { hip: number | null; hd: number | null }[];
}

function readManifest(): MembershipNaming {
  const propers = new Map<string, string>();
  const bayerKeys: { hip: number | null; hd: number | null }[] = [];
  for (const r of MEMBERSHIP_MANIFEST.rows(readFileSync(MANIFEST, 'utf8'))) {
    if (r.proper !== null && !r.isSol) {
      propers.set(membershipProperKey(r.proper, r.hip, r.hd), r.proper);
    }
    if (r.bayer !== null) bayerKeys.push({ hip: r.hip, hd: r.hd });
  }
  return { propers, bayerKeys };
}

async function main(): Promise<void> {
  const nec = parseNecCsv(readFileSync(NEC_CSV, 'utf8'));
  const faints = parseWgsnFaintsCsv(
    readFileSync(FAINTS_CSV, 'utf8'),
    parseFaintsCorrections(readFileSync(FAINTS_CORRECTIONS_TSV, 'utf8')),
  );
  const rows = [...nec, ...faints];

  const classCounts = new Map<string, number>();
  const designations: DesignationRow[] = [];
  const nameRows: WgsnNameRow[] = [];
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
      nameRows.push({
        name, aliases, hip: row.hip, hipComponent: row.hipComponent,
        hr: row.hr, hd: row.hd, hdComponent: row.hdComponent,
        vmag: row.vmag, source: row.source, srcId: row.id,
      });
    }
  }

  const iv27a = unionIv27aBayer(designations, readCrossIndexTable());
  designations.push(...iv27a.added);

  const membership = readManifest();
  const unmatched = new Set<string>();
  let matched = 0;
  for (const [key, proper] of membership.propers) {
    if (nameKeys.has(foldNameKey(proper))) matched++;
    else unmatched.add(key);
  }
  const { missing, stale } = diffDispositions(
    unmatched,
    new Set(parseProperDispositions(readFileSync(DISPOSITIONS, 'utf8'))
      .map((d) => membershipProperKey(d.proper, d.hip, d.hd))),
  );
  if (missing.length > 0 || stale.length > 0) {
    for (const k of missing) console.error(`undisposed membership proper: ${k}`);
    for (const k of stale) {
      console.error(`stale disposition (now matches WGSN or left the manifest): ${k}`);
    }
    console.error(
      '\ndata/iau-wgsn/athyg_proper_dispositions.tsv must enumerate exactly '
      + 'the manifest propers no WGSN name matches (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them).',
    );
    process.exit(1);
  }

  const unioned = bayerKeySets(designations);
  const membershipBayerRowsCovered = membership.bayerKeys.filter(
    (k) => unioned.reaches(k.hip, k.hd),
  ).length;

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
    iv27aBayerCells: iv27a.cells,
    iv27aBayerAdded: iv27a.added.length,
    iv27aBayerCovered: iv27a.covered,
    iv27aVariableRejected: iv27a.variableRejected,
    iv27aUnparsed: iv27a.unparsed,
    designationRows: designations.length,
    designationsKeyless: designations.filter(
      (d) => d.hip === null && d.hr === null && d.hd === null,
    ).length,
    designationDuplicateRows: duplicateDesignationRows(designations),
    nameDuplicateRows: nameRowKeys.length - new Set(nameRowKeys).size,
    membershipPropers: membership.propers.size,
    membershipProperMatched: matched,
    membershipProperResiduals: unmatched.size,
    membershipBayerRows: membership.bayerKeys.length,
    membershipBayerRowsCovered,
  };

  emitArtifacts({
    outputs: WGSN_OUTPUTS,
    files: {
      names: WGSN_NAMES.serialize(nameRows),
      designations: WGSN_DESIGNATIONS.serialize(designations),
    },
    checks: [snapshotCheck<WgsnCounts>({
      envVar: 'UPDATE_BUILD_COUNTS',
      snapshotPath: SNAPSHOT,
      actual: counts,
      compare: compareCountSnapshot,
      failureLabel: 'WGSN table counts',
      refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:wgsn',
    })],
  });
  console.log(`wgsn_names.tsv: ${nameRows.length} rows`);
  console.log(`wgsn_designations.tsv: ${designations.length} rows`);
}

runStep(main);
