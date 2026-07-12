import { describe, it, expect } from 'vitest';

import { isDustPublicAsset } from './sync-dust-pure';

describe('sync-dust / isDustPublicAsset', () => {
  it('allows the runtime-consumed artifacts', () => {
    expect(isDustPublicAsset('manifest.json')).toBe(true);
    expect(isDustPublicAsset('particles.bin')).toBe(true);
    expect(isDustPublicAsset('chunk_0_0_0.bin')).toBe(true);
    expect(isDustPublicAsset('chunk_3_12_3.bin')).toBe(true);
  });

  it('rejects docs, source, and intermediates', () => {
    expect(isDustPublicAsset('README.md')).toBe(false);
    expect(isDustPublicAsset('build-dust.py')).toBe(false);
    expect(isDustPublicAsset('.voxels.npy')).toBe(false);
    expect(isDustPublicAsset('notes.txt')).toBe(false);
    expect(isDustPublicAsset('chunk_0_0_0.bin.bak')).toBe(false);
    expect(isDustPublicAsset('chunk_a_b_c.bin')).toBe(false);
  });
});
