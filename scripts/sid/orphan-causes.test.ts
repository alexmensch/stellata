import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { IdentityRow } from '../catalog/lineage/identity-pure';
import { LINEAGE_LAYOUT, readIdentity, stageFile, streamLineage } from '../catalog/lineage/lineage-io';
import { stageLineageLine, type LineageLine, type LineageRow } from '../catalog/lineage/lineage-row-pure';
import { LINEAGE_STAGES } from '../catalog/lineage/lineage-stages';
import { LIVE, codeEffects, stageCodes } from '../catalog/lineage/reason-codes-pure';
import { artifactText, isReadable } from '../util/sources/source';
import { BUILT_OBJECT_INPUTS, builtObjects } from './built-objects';
import { EVENTS, eventsFile } from './events-tsv';
import { LEDGER, ledgerFile } from './ledger-tsv';
import { orphanCauses } from './orphan-causes-pure';
import { allocate } from './sid-pure';
import { SIBLING_NAMESPACES } from './sibling-artifacts';
import { loadStoredEdges } from './stored-edges';

const CODES = stageCodes('fixture', {
  parked: { description: 'Parked.', effect: 'park', status: LIVE },
  kept: { description: 'Kept.', effect: 'none', status: LIVE },
});

const identityRow = (key: string, designations: string[]): IdentityRow => (
  { key, tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '', designations }
);

const line = (key: string, branch: 'parked' | 'kept', role: LineageRow['role'] = 'outcome'): LineageLine => (
  stageLineageLine(CODES, { stage: 'fixture', key, role, code: CODES.code(branch), params: '', evidence: [] })
);

const effects = codeEffects([CODES]);

describe('orphanCauses', () => {
  it('joins an orphan through every identity row carrying it to that origin\'s removal outcomes', () => {
    const causes = orphanCauses(
      ['gaia_dr3:1', 'hip:2'],
      [identityRow('a', ['gaia_dr3:1']), identityRow('b', ['hip:9', 'gaia_dr3:1'])],
      [line('a', 'kept'), line('b', 'parked')],
      effects,
    );
    expect(causes.get('gaia_dr3:1')).toEqual([{ origin: 'b', code: 'fixture.parked', effect: 'park' }]);
    expect(causes.get('hip:2')).toEqual([]);
  });

  it('ignores refused alternatives and rows under other origins', () => {
    const causes = orphanCauses(
      ['gaia_dr3:1'],
      [identityRow('a', ['gaia_dr3:1'])],
      [line('a', 'parked', 'refused'), line('z', 'parked')],
      effects,
    );
    expect(causes.get('gaia_dr3:1')).toEqual([]);
  });
});

const IDENTITY_FILES = LINEAGE_STAGES.flatMap(({ spec }) => (
  spec.identity === undefined ? [] : [stageFile(LINEAGE_LAYOUT.current, spec.identity)]
));
const STAGE_FILES = LINEAGE_STAGES.map(({ spec }) => stageFile(LINEAGE_LAYOUT.current, spec.stage));
const built = [...BUILT_OBJECT_INPUTS, ...IDENTITY_FILES, ...STAGE_FILES].every(existsSync)
  && isReadable(LEDGER);

describe.skipIf(!built)('every orphaned ledger SID has a recorded cause', () => {
  it('leaves no star, sol or shell orphan unexplained', async () => {
    const { objects } = await builtObjects();
    const result = allocate({
      objects,
      storedEdges: loadStoredEdges(),
      ledger: ledgerFile(artifactText(LEDGER)).rows,
      events: eventsFile(artifactText(EVENTS)).rows,
      today: '2000-01-01',
    });
    expect(result.errors).toEqual([]);
    const orphans = [...result.orphaned]
      .filter(([ns]) => !SIBLING_NAMESPACES.has(ns))
      .flatMap(([, keys]) => keys);
    const causes = orphanCauses(
      orphans,
      IDENTITY_FILES.flatMap(readIdentity),
      (function* () { for (const f of STAGE_FILES) yield* streamLineage(f); })(),
      codeEffects(LINEAGE_STAGES.map((s) => s.codes)),
    );
    const unexplained = [...causes].filter(([, c]) => c.length === 0).map(([d]) => d);
    expect(unexplained.length, unexplained.slice(0, 40).join('\n')).toBe(0);
  }, 180_000);
});
