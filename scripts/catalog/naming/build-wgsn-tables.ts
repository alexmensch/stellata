// `pnpm run build:wgsn`: the keyed WGSN tables. See README.md.

import { resolve } from 'node:path';

import { CROSS_INDEX } from '../classic-ids/cross-index-source';
import { REPO_ROOT } from '../../util/paths';
import { emitArtifacts, runStep } from '../../util/emit-artifacts';
import { snapshotCheck } from '../../util/snapshot-check';
import { compareCountSnapshot } from '../build-counts';
import { WGSN_FAINTS } from './wgsn-faints-source';
import { WGSN_NEC } from './wgsn-nec-source';
import {
  foldNameKey,
  normaliseWgsnCell,
  splitNameCell,
} from './wgsn-normalise-pure';
import {
  designationFromCell,
  duplicateDesignationRows,
  unionIv27aBayer,
  type DesignationRow,
} from './wgsn-tables-pure';
import type { WgsnNameRow } from './wgsn-index-pure';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';
import { WGSN_OUTPUTS } from './wgsn-tables-outputs';

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
}

async function main(): Promise<void> {
  const nec = WGSN_NEC.read();
  const faints = WGSN_FAINTS.read();
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

  const iv27a = unionIv27aBayer(designations, CROSS_INDEX.read());
  designations.push(...iv27a.added);

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
  };

  emitArtifacts({
    outputs: WGSN_OUTPUTS,
    files: {
      names: WGSN_NAMES.serialize(nameRows),
      designations: WGSN_DESIGNATIONS.serialize(designations),
    },
    checks: [snapshotCheck<WgsnCounts>({
      snapshotPath: SNAPSHOT,
      actual: counts,
      compare: compareCountSnapshot,
      failureLabel: 'WGSN table counts',
      refreshCommand: 'UPDATE_SNAPSHOTS=1 pnpm run build:wgsn',
    })],
  });
  console.log(`wgsn_names.tsv: ${nameRows.length} rows`);
  console.log(`wgsn_designations.tsv: ${designations.length} rows`);
}

runStep(main);
