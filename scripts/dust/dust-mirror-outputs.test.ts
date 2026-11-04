import { describe, it, expect } from 'vitest';

import { declaresName } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './dust-mirror-outputs';

describe('dust mirror outputs', () => {
  it('allows the runtime-consumed artifacts', () => {
    expect(declaresName(MIRROR_OUTPUTS, 'manifest.json')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'chunk_0_0_0.bin')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'chunk_3_12_3.bin')).toBe(true);
  });

  it('rejects docs, source, and intermediates', () => {
    expect(declaresName(MIRROR_OUTPUTS, 'README.md')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'build-dust.py')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, '.voxels-main-10c823a5fcf81b47b6e15530bcdf54dc.npy')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'notes.txt')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'chunk_0_0_0.bin.bak')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'chunk_a_b_c.bin')).toBe(false);
  });
});
