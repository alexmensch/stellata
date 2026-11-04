import { describe, expect, it } from 'vitest';

import { PROBE_MISSIONS } from '../../src/catalog-format/probes/probe-roster';
import { rosterFileName } from '../../src/catalog-format/public-artifacts/public-artifacts';
import { declaresName } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './probes-mirror-outputs';

describe('probes mirror outputs', () => {
  it('ships every roster trajectory', () => {
    for (const probe of PROBE_MISSIONS) expect(declaresName(MIRROR_OUTPUTS, rosterFileName(probe.id))).toBe(true);
  });

  it('keeps folder docs and strays out of the bundle', () => {
    for (const name of ['README.md', 'cassini.json', 'voyager1.json.bak', 'voyager1']) {
      expect(declaresName(MIRROR_OUTPUTS, name)).toBe(false);
    }
  });
});
