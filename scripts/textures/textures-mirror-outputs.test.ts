import { describe, it, expect } from 'vitest';

import { declaresName } from '../util/mirror-to-public';
import { MIRROR_OUTPUTS } from './textures-mirror-outputs';

describe('textures mirror outputs', () => {
  it('allows the built runtime artifacts', () => {
    expect(declaresName(MIRROR_OUTPUTS, 'earth-1024.jpg')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'earth-8192.jpg')).toBe(true);
    // Non-power-of-two top rungs are a body's own master width.
    expect(declaresName(MIRROR_OUTPUTS, 'jupiter-3601.jpg')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'venus-1800.jpg')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'saturn-rings.png')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'uranus-rings.png')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'neptune-rings.png')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-normal.webp')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'mercury-normal.webp')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-horizon-a.webp')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-horizon-b.webp')).toBe(true);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-skyview.webp')).toBe(true);
  });

  it('rejects docs and source originals', () => {
    expect(declaresName(MIRROR_OUTPUTS, 'README.md')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'src')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'mercury-pia15063.JPG')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'rings-color-bjj.txt')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'rings-uranus.tsv')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'earth-8192.jpg.bak')).toBe(false);
    // The pre-ladder flat name: a leftover would ship as a file the
    // renderer never requests, so the rung width is required.
    expect(declaresName(MIRROR_OUTPUTS, 'earth.jpg')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'other.png')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-dem-svs.tif')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'relief.json')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-normal.webp.bak')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-horizon-c.webp')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-horizon.webp')).toBe(false);
    expect(declaresName(MIRROR_OUTPUTS, 'moon-skyviews.webp')).toBe(false);
  });
});
