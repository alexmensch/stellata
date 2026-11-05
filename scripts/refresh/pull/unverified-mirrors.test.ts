import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANUAL_STAMP_FOLDER } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT } from '../../util/paths';
import { unverifiedAnswers } from './tap-pure';

const VERIFY = 'an unverified mirror answered: run its live checks (README.md#the-tap-backend), then set its verified flag in tap-pure.ts';

describe('no committed pull record was answered by an unverified mirror', () => {
  const folder = join(REPO_ROOT, MANUAL_STAMP_FOLDER);
  const records = readdirSync(folder).filter((f) => f.endsWith('.json'));

  it.each(records)('%s', (file) => {
    const { answeredBy = [] } = JSON.parse(readFileSync(join(folder, file), 'utf8')) as { answeredBy?: string[] };
    expect(unverifiedAnswers(answeredBy), VERIFY).toEqual([]);
  });
});

describe('unverifiedAnswers', () => {
  it('names CDS and SIMBAD-CDS and passes every measured mirror', () => {
    expect(unverifiedAnswers(['ARI-sync', 'CDS', 'SIMBAD-Harvard', 'SIMBAD-CDS', 'ESA-sync', 'ssd.jpl.nasa.gov']))
      .toEqual(['CDS', 'SIMBAD-CDS']);
  });
});
