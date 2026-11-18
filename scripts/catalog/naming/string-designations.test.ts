import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { readArtifact } from '../../util/sources/source';
import { SIMBAD_IDENTS } from '../simbad/simbad-idents-source';
import type { SimbadIdentsObject } from '../simbad/simbad-flamsteed-pure';
import { expandSimbadIdent, identAttests, type EponymRow } from './string-designations-pure';
import { EPONYMS, NAME_DROPS } from './string-designations-source';
import { SIMBAD_SHORT_FORMS } from './simbad-short-forms-source';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';

const eponyms = EPONYMS.read();
const forms = SIMBAD_SHORT_FORMS.read();

function objectKeys(object: SimbadIdentsObject): Set<string> {
  return new Set([
    ...object.hds.map((hd) => `hd:${hd}`),
    ...object.hips.map((hip) => `hip:${hip}`),
    ...object.sourceIds.map((id) => `gaia:${id}`),
  ]);
}

describe('the committed naming tables', () => {
  it('pins the rows: 23 eponyms (22 SIMBAD, 1 WGSN) and 20 dropped names', () => {
    expect(eponyms.filter((r) => r.citation.source === 'simbad')).toHaveLength(22);
    expect(eponyms.filter((r) => r.citation.source === 'wgsn')).toHaveLength(1);
    expect(NAME_DROPS.read()).toHaveLength(20);
  });

  it('cites, for each WGSN eponym, a Gould row of the authority the record\'s key reaches', () => {
    const goulds = readArtifact(WGSN_DESIGNATIONS).filter((d) => d.kind === 'gould');
    for (const row of eponyms.filter((r) => r.citation.source === 'wgsn')) {
      const spelled = goulds
        .filter((d) => [`hd:${d.hd}`, `hip:${d.hip}`].includes(row.key))
        .map((d) => `${d.num} G. ${d.dc}`);
      expect(spelled, row.name).toContain(row.name);
    }
  });

  it.skipIf(isLfsPointerFile(resolve(REPO_ROOT, SIMBAD_IDENTS.file)))(
    'cites, for each SIMBAD eponym, an object the record\'s key reaches holding an ident that spells the name',
    () => {
      const byOid = new Map(SIMBAD_IDENTS.read().map((o) => [o.oid, o]));
      const failures: string[] = [];
      for (const row of eponyms) {
        if (row.citation.source !== 'simbad') continue;
        const object = byOid.get(row.citation.oid);
        const why = object === undefined ? 'no such object'
          : !objectKeys(object).has(row.key) ? `the object does not carry ${row.key}`
            : !object.idents.includes(row.citation.ident) ? `the object holds no ${row.citation.ident}`
              : !identAttests(row.citation.ident, row.name, forms) ? `${row.citation.ident} does not spell it`
                : null;
        if (why !== null) failures.push(`${row.name}: ${why}`);
      }
      expect(failures).toEqual([]);
    },
  );

  it('uses every short form, so the table holds no expansion nothing cites', () => {
    const cited = (row: EponymRow) => (row.citation.source === 'simbad' ? [row.citation.ident] : []);
    const unused = forms.filter((f) => !eponyms.flatMap(cited)
      .some((ident) => expandSimbadIdent(ident, [f]) !== null));
    expect(unused).toEqual([]);
  });
});
