import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import type { Artifact } from '../../util/tsv/artifact-pure';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';

function roundTrips<C extends string, R>(artifact: Artifact<C, R>): void {
  const path = resolve(REPO_ROOT, artifact.file);
  describe.skipIf(!lfsContentReadable(path))(`${artifact.file} codec over the committed file`, () => {
    it('round-trips byte for byte', () => {
      const text = readFileSync(path, 'utf8');
      expect(artifact.serialize(artifact.parse(text)) === text).toBe(true);
    });
  });
}

roundTrips(WGSN_NAMES);
roundTrips(WGSN_DESIGNATIONS);

describe('wgsn_names.tsv codec', () => {
  const header = WGSN_NAMES.columns.join('\t');

  it('splits the alias cell and reads absent keys as null', () => {
    const [named, keyless] = WGSN_NAMES.parse(
      `${header}\nNganurganity\tUnurgunite\t33856\t\t2646\t53244\t\t3.5\tnec\t4200\n`
      + 'Maru\t\t\t\t\t\t\t9.9\tfaints\t12\n',
    );
    expect(named).toEqual({
      name: 'Nganurganity', aliases: ['Unurgunite'], hip: 33856, hipComponent: null,
      hr: 2646, hd: 53244, hdComponent: null, vmag: 3.5, source: 'nec', srcId: '4200',
    });
    expect(keyless).toMatchObject({ aliases: [], hip: null, hr: null, hd: null });
  });
});

describe('wgsn_designations.tsv codec', () => {
  const header = WGSN_DESIGNATIONS.columns.join('\t');

  it('reads a Gould row', () => {
    expect(WGSN_DESIGNATIONS.parse(`${header}\ngould\t\t\t4\tSer\tCau\t\t\t\t123456\tnec\n`)[0])
      .toMatchObject({ kind: 'gould', num: 4, dc: 'Ser', half: 'Cau', letter: null, hd: 123456 });
  });

  it('refuses an unknown source', () => {
    expect(() => WGSN_DESIGNATIONS.parse(`${header}\nbayer\tα\t\t\tLyr\t\t\t\t\t1\tsimbad\n`))
      .toThrow(/source/);
  });
});
