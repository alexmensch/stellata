// The SID objects build:catalog allocates, in allocation order: its records, then the sol and shell lists.

import { FLAG_IS_SOL } from '../../src/catalog-format/record/catalog-pure';
import type { Star } from '../catalog/parse/stars-parse';
import { sourceRowRef, sourceRowRefText } from '../util/sources/row-ref-pure';
import type { SidObject } from './allocate-pure';
import { allocationAdmissionCode } from './allocation-lineage-pure';
import { SHELL_OBJECTS, SOL_OBJECTS } from './object-mints-source';
import { starDesignations } from './sid-pure';

export function catalogSidObjects(stars: readonly Star[]): SidObject[] {
  const records = stars.map((s, i): SidObject => ({
    designations: starDesignations({ ...s, isSol: (s.flags & FLAG_IS_SOL) !== 0 }),
    kind: 'star',
    label: `record ${i}${s.proper ? ` (${s.proper})` : ''}`,
    origin: s.originKey,
    admission: { kind: 'lineage' },
  }));
  const solRows = SOL_OBJECTS.read();
  const sun = solRows.find((r) => r.key === 'sun');
  if (!sun || sun.kind !== 'star') throw new Error('sol-objects.tsv must carry "sun" with kind star');
  // sol:sun rides the FLAG_IS_SOL record (/docs/sid.md#7-storage--sid-in-every-artifact), so it is not a second object.
  const sol = solRows.filter((row) => row.key !== 'sun').map((row): SidObject => ({
    designations: [`sol:${row.key}`],
    kind: row.kind,
    label: `sol ${row.key}`,
    origin: sourceRowRefText(sourceRowRef(SOL_OBJECTS, row)),
    admission: { kind: 'declared', code: allocationAdmissionCode('mint.sol-list') },
  }));
  const shell = SHELL_OBJECTS.read().map((row): SidObject => ({
    designations: [`shell:${row.key}`],
    kind: row.kind,
    label: `shell ${row.key}`,
    origin: sourceRowRefText(sourceRowRef(SHELL_OBJECTS, row)),
    admission: { kind: 'declared', code: allocationAdmissionCode('mint.shell-list') },
  }));
  return [...records, ...sol, ...shell];
}
