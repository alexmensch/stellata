import { describe, it, expect } from 'vitest';

import { isTexturePublicAsset } from './sync-textures-pure';

describe('sync-textures / isTexturePublicAsset', () => {
  it('allows the built runtime artifacts', () => {
    expect(isTexturePublicAsset('earth-1024.jpg')).toBe(true);
    expect(isTexturePublicAsset('earth-8192.jpg')).toBe(true);
    // Non-power-of-two top rungs are a body's own master width.
    expect(isTexturePublicAsset('jupiter-3601.jpg')).toBe(true);
    expect(isTexturePublicAsset('venus-1800.jpg')).toBe(true);
    expect(isTexturePublicAsset('saturn-rings.png')).toBe(true);
    expect(isTexturePublicAsset('uranus-rings.png')).toBe(true);
    expect(isTexturePublicAsset('neptune-rings.png')).toBe(true);
    expect(isTexturePublicAsset('moon-normal.webp')).toBe(true);
    expect(isTexturePublicAsset('mercury-normal.webp')).toBe(true);
    expect(isTexturePublicAsset('moon-horizon-a.webp')).toBe(true);
    expect(isTexturePublicAsset('moon-horizon-b.webp')).toBe(true);
  });

  it('rejects docs and source originals', () => {
    expect(isTexturePublicAsset('README.md')).toBe(false);
    expect(isTexturePublicAsset('src')).toBe(false);
    expect(isTexturePublicAsset('mercury-pia15063.JPG')).toBe(false);
    expect(isTexturePublicAsset('rings-color-bjj.txt')).toBe(false);
    expect(isTexturePublicAsset('rings-uranus.tsv')).toBe(false);
    expect(isTexturePublicAsset('earth-8192.jpg.bak')).toBe(false);
    // The pre-ladder flat name: a leftover would ship as a file the
    // renderer never requests, so the rung width is required.
    expect(isTexturePublicAsset('earth.jpg')).toBe(false);
    expect(isTexturePublicAsset('other.png')).toBe(false);
    expect(isTexturePublicAsset('moon-dem-svs.tif')).toBe(false);
    expect(isTexturePublicAsset('relief.json')).toBe(false);
    expect(isTexturePublicAsset('moon-normal.webp.bak')).toBe(false);
    expect(isTexturePublicAsset('moon-horizon-c.webp')).toBe(false);
    expect(isTexturePublicAsset('moon-horizon.webp')).toBe(false);
  });
});
