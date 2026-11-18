// The curated corrections to SIMBAD's sibling-component word the label merge reads, declared, and the set they compose.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

export interface SiblingListRow {
  readonly sourceId: string;
  readonly wdsId: string;
}

function siblingList(file: string) {
  return defineSource({
    file,
    hint: 'It is committed and hand-curated (../classic-ids/label-merge/README.md#an-alias-stops-at-the-blend).',
    parse: (input): SiblingListRow[] => [...readTable(
      { file: input.file, hint: input.hint, columns: ['gaia_source_id', 'wds_id'] }, input.text(),
    )].map((row) => ({ sourceId: row.requiredSourceId('gaia_source_id'), wdsId: row.text('wds_id') ?? row.fail('wds_id is empty') })),
  });
}

/** Sources with a rendered sibling SIMBAD's WDS cross-IDs do not name. */
export const SIBLING_RENDERED = siblingList('data/membership/sibling-rendered.tsv');

/** Sources SIMBAD's WDS cross-IDs give a sibling that binaries renders no pair for. */
export const SIBLING_UNRENDERED = siblingList('data/membership/sibling-unrendered.tsv');

export function siblingRenderedSourceIds(
  simbadSiblings: ReadonlySet<string>,
  rendered: readonly SiblingListRow[],
  unrendered: readonly SiblingListRow[],
): Set<string> {
  const out = new Set([...simbadSiblings, ...rendered.map((r) => r.sourceId)]);
  for (const r of unrendered) out.delete(r.sourceId);
  return out;
}
