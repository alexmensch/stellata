// Stage 6's spectral-type masses per multiples.tsv row as the masses lineage stage: the branch each was read off, and what it fed. See README.md#masses-lineage.

import { namedExceptionsInvariant, type LineageInvariant } from '../../catalog/lineage/lineage-invariant-pure';
import { stageLineageLine, stageRow, type LineageLine, type LineageParams, type LineageRow } from '../../catalog/lineage/lineage-row-pure';
import { kebab, outcomeCode, stageCodes, taggedCodes } from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { hipDesignation } from '../../sid/sid-pure';
import { rowKeyText } from '../../util/sources/row-ref-pure';
import { MASS_BRANCHES, type MassBranch } from '../masses/mass-estimate-pure';
import type { MultiplesRecord } from '../multiples-record-pure';
import { MULTIPLES_ROW_KEY } from '../multiples-row-key-pure';
import type { MassRead } from './multiples-rows-pure';
import { MASSES_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const MASSES_LINEAGE_BUDGET = { gzipBytes: 800_000, writeMs: 1_000 };

const BRANCH_TEXT: Record<MassBranch, string> = {
  main_sequence: 'the main-sequence table of Cox 2000 (/data/papers/index.md#cox2000), its type a dwarf or subdwarf',
  main_sequence_assumed: 'the main-sequence table of Cox 2000 (/data/papers/index.md#cox2000), its type stating no luminosity class',
  subgiant: 'the subgiant weighting of the giant and main-sequence tables',
  giant: 'the giant table of Cox 2000 (/data/papers/index.md#cox2000)',
  supergiant: 'the supergiant table of Cox 2000 (/data/papers/index.md#cox2000)',
  white_dwarf: 'the white-dwarf default mass',
  carbon_wr: 'the carbon / S / Wolf-Rayet default mass',
};

export const MASSES_CODES = stageCodes(MASSES_LINEAGE.stage, {
  ...taggedCodes('read.', MASS_BRANCHES, (branch) => outcomeCode(`Stage 6 read the component's mass off ${BRANCH_TEXT[branch]}.`)),
  'read.no-type': outcomeCode('Stage 6 read the component\'s mass and found no spectral type, so none.'),
  'read.unparsed': outcomeCode('Stage 6 read the component\'s mass and found a spectral type the parser cannot read, so none.'),
  'not-read': outcomeCode('Stage 6 read no mass for the component: no orbit, or one publishing q and a.'),
});

function idParams(r: MultiplesRecord): LineageParams {
  return {
    ...(r.gaiaSourceId === null ? {} : { gaia: r.gaiaSourceId }),
    ...(r.hip === null ? {} : { hip: hipDesignation(r.hip) }),
  };
}

export function* massesLineageRows(massReads: ReadonlyMap<MultiplesRecord, MassRead | null>): Generator<LineageRow> {
  for (const [r, read] of massReads) {
    const key = rowKeyText(MULTIPLES_ROW_KEY, r);
    if (read === null) {
      yield stageRow(MASSES_CODES, key, 'not-read', idParams(r), []);
      continue;
    }
    const spect: LineageParams = r.spect === '' ? {} : { spect: r.spect };
    yield stageRow(MASSES_CODES, key, `read.${kebab(read.mass.kind)}`, { ...idParams(r), ...spect, for: read.uses.join(',') }, []);
  }
}

export function massesLineageLines(massReads: ReadonlyMap<MultiplesRecord, MassRead | null>): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of massesLineageRows(massReads)) lines.push(stageLineageLine(MASSES_CODES, row));
  return lines;
}

const UNPARSED: readonly (readonly [systemId: string, comp: string, spect: string])[] = [
  ['01095+4715-AB', 'A', '(B8)III'], ['01095+4715-AB', 'B', '(B8)III'], ['05133+3720-Aa,Ab', 'Ab', 'L/T'],
  ['05135+0158-AB', 'B', '(K)'], ['08503+1057-Ba,Bb', 'Ba', 'L6.5'], ['08503+1057-Ba,Bb', 'Bb', 'L7'],
  ['11125+3549-Ea,Eb', 'Ea', 'L4'], ['11125+3549-Ea,Eb', 'Eb', 'L6'], ['14503+2355-BC', 'B', 'L4+L4'],
  ['14503+2355-BC', 'C', 'L4+L4'], ['15329+3122-AB', 'A', '(B5)V'], ['15329+3122-AB', 'B', '(B5)V'],
  ['19236+3313-AB', 'B', 'T9'], ['20041+1704-Aa,Ab', 'Ab', 'L4-5'], ['20598+4731-Aa,Ab', 'Ab', '(09V)'],
  ['22034-5647-Ba,Bb', 'Ba', 'T1'], ['22034-5647-Ba,Bb', 'Bb', 'T6'], ['23404+4420-Aa,Ab', 'Ab', 'L1'],
  ['23516+3127-AB', 'B', 'L0'],
];

export const MASSES_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(
    MASSES_CODES, 'read.unparsed',
    'every spectral type Stage 6 reads a mass off parses, but the rows named',
    new Map(UNPARSED.map(([systemId, comp, spect]) => [
      rowKeyText(MULTIPLES_ROW_KEY, { systemId, comp }), `"${spect}": no table reads an L / T dwarf or a type whose class is in parentheses`,
    ])),
  ),
];
