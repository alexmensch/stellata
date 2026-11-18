import { describe, expect, it } from 'vitest';

import { artifactRows, isReadable, readArtifact } from '../../util/sources/source';
import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import { parseSimbadWdsXidsTsv, sourcesWithSiblingComponent } from './binding/binding-gate-pure';
import { SIMBAD_WDS_XIDS } from './binding/simbad-wds-xids-source';
import { MEMBERSHIP_MANIFEST } from './membership-manifest-tsv';
import { SIBLING_RENDERED, SIBLING_UNRENDERED, siblingRenderedSourceIds } from './sibling-rendered-source';

describe('siblingRenderedSourceIds', () => {
  const row = (sourceId: string) => ({ sourceId, wdsId: '00000+0000' });

  it('unions SIMBAD and the rendered list, less the unrendered list', () => {
    expect([...siblingRenderedSourceIds(new Set(['1', '2']), [row('3')], [row('2')])].sort()).toEqual(['1', '3']);
  });
});

describe.skipIf(![MULTIPLES_TSV, MEMBERSHIP_MANIFEST, SIMBAD_WDS_XIDS, SIBLING_RENDERED, SIBLING_UNRENDERED].every(isReadable))(
  'the sibling lists, against the committed multiples.tsv', () => {
    const multiples = readArtifact(MULTIPLES_TSV);
    const componentsBySystem = new Map<string, Set<string>>();
    for (const r of multiples) {
      const comps = componentsBySystem.get(r.systemId) ?? new Set<string>();
      componentsBySystem.set(r.systemId, comps.add(r.comp));
    }
    const siblingSystemsOf = new Map<string, Set<string>>();
    for (const r of multiples) {
      if (r.gaiaSourceId === null || componentsBySystem.get(r.systemId)!.size < 2) continue;
      const systems = siblingSystemsOf.get(r.gaiaSourceId) ?? new Set<string>();
      siblingSystemsOf.set(r.gaiaSourceId, systems.add(r.systemId.slice(0, 10)));
    }
    const simbadSiblings = sourcesWithSiblingComponent(parseSimbadWdsXidsTsv(SIMBAD_WDS_XIDS.read()));
    const listed = SIBLING_RENDERED.read();
    const unrendered = SIBLING_UNRENDERED.read();
    const withheld = siblingRenderedSourceIds(simbadSiblings, listed, unrendered);

    it('lists only sources multiples.tsv still gives a sibling, in the system it names', () => {
      expect(listed.filter((r) => !siblingSystemsOf.get(r.sourceId)?.has(r.wdsId))).toEqual([]);
    });

    it('lists as unrendered only sources SIMBAD names a sibling for and multiples.tsv gives none', () => {
      expect(unrendered.filter((r) => !simbadSiblings.has(r.sourceId) || siblingSystemsOf.has(r.sourceId))).toEqual([]);
    });

    it('ships no alias on a source multiples.tsv gives a sibling that neither SIMBAD nor the list names', () => {
      const unwithheld = [...artifactRows(MEMBERSHIP_MANIFEST)]
        .filter((r) => r.gaiaSourceId !== null && (r.hdAlt.length > 0 || r.hrAlt.length > 0))
        .filter((r) => siblingSystemsOf.has(r.gaiaSourceId!) && !withheld.has(r.gaiaSourceId!))
        .map((r) => `${r.gaiaSourceId} ${[...siblingSystemsOf.get(r.gaiaSourceId!)!].join('|')}`);
      expect(unwithheld).toEqual([]);
    });
  },
);
