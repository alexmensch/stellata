// Each multiples.tsv component's Gaia and HIP binding provenance as a lineage stage: its reason codes and the one serialiser. See README.md#binding-lineage.

import { stageLineageLine, stageRow, type LineageLine, type LineageRow } from '../../catalog/lineage/lineage-row-pure';
import { outcomeCode, stageCodes, type CodeDeclaration, type StageCounts } from '../../catalog/lineage/reason-codes/reason-codes-pure';
import { rowKeyText } from '../../util/sources/row-ref-pure';
import { MULTIPLES_ROW_KEY } from '../multiples-row-key-pure';
import { INHERITANCE_KINDS, type IdOrigin, type InheritanceKind, type MultiplesRecord } from '../multiples-record-pure';
import { BINDING_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const BINDING_LINEAGE_BUDGET = { gzipBytes: 1_000_000, writeMs: 2_000 };

const IDENTIFIERS = { gaia: 'Gaia DR3 source', hip: 'HIP number' } as const;
type Identifier = keyof typeof IDENTIFIERS;

const COPIED: Record<InheritanceKind, string> = {
  blend: 'from the primary of the ρ = 0 pair it is the secondary of',
  letter: 'from its sub-letter (A ← Aa)',
  parent: 'from its parent token (Aa ← A)',
  partner: 'from its pair\'s primary at a measured or unmeasured ρ',
};

type Branch<I extends Identifier> = `${I}.own` | `${I}.unbound` | `${I}.inherited.${InheritanceKind}`;

function identifierCodes<I extends Identifier>(id: I): Record<Branch<I>, CodeDeclaration> {
  const what = IDENTIFIERS[id];
  return Object.fromEntries([
    [`${id}.own`, outcomeCode(`The component bound its ${what} itself.`)],
    ...INHERITANCE_KINDS.map((how) => [`${id}.inherited.${how}`, outcomeCode(`The component's ${what} is copied ${COPIED[how]}.`)]),
    [`${id}.unbound`, outcomeCode(`The component has no ${what}.`)],
  ]) as Record<Branch<I>, CodeDeclaration>;
}

export const BINDING_CODES = stageCodes(BINDING_LINEAGE.stage, {
  ...identifierCodes('gaia'),
  ...identifierCodes('hip'),
});

/** Binding's count block: its lines folded per live code. */
export type BindingCounts = StageCounts<typeof BINDING_CODES>;

function identifierRow<I extends Identifier>(
  key: string, id: I, value: string | null, origin: IdOrigin | null,
): LineageRow {
  if (value === null || origin === null) return stageRow(BINDING_CODES, key, `${id}.unbound`, {}, []);
  if (origin.kind === 'own') return stageRow(BINDING_CODES, key, `${id}.own`, { [id]: value }, []);
  return stageRow(BINDING_CODES, key, `${id}.inherited.${origin.how}`, { [id]: value, from: origin.from }, []);
}

export function* bindingLineageRows(records: readonly MultiplesRecord[]): Generator<LineageRow> {
  for (const r of records) {
    const key = rowKeyText(MULTIPLES_ROW_KEY, r);
    yield identifierRow(key, 'gaia', r.gaiaSourceId, r.gaiaOrigin);
    yield identifierRow(key, 'hip', r.hip === null ? null : `hip:${r.hip}`, r.hipOrigin);
  }
}

export function bindingLineageLines(records: readonly MultiplesRecord[]): LineageLine[] {
  const lines: LineageLine[] = [];
  for (const row of bindingLineageRows(records)) lines.push(stageLineageLine(BINDING_CODES, row));
  return lines;
}
