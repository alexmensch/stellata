import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  TEXTURE_VRAM_BUDGET_BYTES,
  evictionOrder,
  otherRungs,
  textureBytes,
  type ResidentTexture,
} from './texture-budget-pure';

const MB = 1024 * 1024;

describe('textureBytes', () => {
  it('adds exactly a third for the mip chain', () => {
    expect(textureBytes(1024, 512, 4)).toBe(Math.round((1024 * 512 * 4 * 4) / 3));
  });

  it('puts the numbers that motivated the budget where they can be read', () => {
    // These are the figures the whole eviction design exists for: one 8192
    // colour map costs sixteen times a 2048, and the old world only ever
    // held 2048s.
    expect(textureBytes(2048, 1024, 4) / 1e6).toBeCloseTo(11.2, 1);
    expect(textureBytes(8192, 4096, 4) / 1e6).toBeCloseTo(179.0, 1);
    // RG8 relief is half of what an RGBA8 upload of the same map would cost.
    expect(textureBytes(4096, 2048, 2) / textureBytes(4096, 2048, 4)).toBeCloseTo(0.5, 6);
  });

  it('fits one body at the camera floor inside the budget', () => {
    // Earth is the worst case: top colour rung plus an 8192 normal and a
    // 4096 horizon pair. If this ever stopped fitting, the body the camera
    // is looking at would evict its own maps every frame.
    const earthAtFloor =
      textureBytes(8192, 4096, 4)
      + textureBytes(8192, 4096, 2)
      + 2 * textureBytes(4096, 2048, 4);
    expect(earthAtFloor).toBeLessThan(TEXTURE_VRAM_BUDGET_BYTES);
  });
});

describe('evictionOrder', () => {
  const t = (key: string, mb: number, lastFrame: number): ResidentTexture =>
    ({ key, bytes: mb * MB, lastFrame });

  it('releases nothing while inside the budget', () => {
    expect(evictionOrder([t('a', 10, 1), t('b', 10, 2)], 100 * MB, 5)).toEqual([]);
  });

  it('never evicts anything drawn this frame, however large', () => {
    // The map on screen is the one that must not go: dropping it flips the
    // body to its placeholder mid-view, which is worse than being over budget.
    const resident = [t('onscreen', 400, 9), t('stale', 10, 1)];
    expect(evictionOrder(resident, 100 * MB, 9)).toEqual(['stale']);
  });

  it('takes the least recently drawn first', () => {
    const resident = [t('newest', 60, 8), t('oldest', 60, 1), t('middle', 60, 4)];
    expect(evictionOrder(resident, 100 * MB, 9)).toEqual(['oldest', 'middle']);
  });

  it('breaks ties by size, biggest first', () => {
    // Evicting one 179 MB map beats evicting sixteen 1024s that cost nothing
    // to hold.
    const resident = [t('small', 3, 2), t('big', 179, 2), t('mid', 45, 2)];
    expect(evictionOrder(resident, 50 * MB, 9)[0]).toBe('big');
  });

  it('stops as soon as it is back under, rather than clearing out', () => {
    const resident = [t('a', 60, 1), t('b', 60, 2), t('c', 60, 3)];
    // 180 total, budget 100 -> shedding two is enough.
    expect(evictionOrder(resident, 100 * MB, 9)).toHaveLength(2);
  });

  it('gives up gracefully when the drawn set alone is over budget', () => {
    // Nothing to shed and no thrash: report what can go, which is nothing.
    const resident = [t('a', 400, 9), t('b', 400, 9)];
    expect(evictionOrder(resident, 100 * MB, 9)).toEqual([]);
  });
});

describe('otherRungs', () => {
  it('frees every narrower rung once a wider one is drawn', () => {
    expect(otherRungs([1024, 2048, 4096, 8192], 8192)).toEqual([1024, 2048, 4096]);
  });

  it('frees WIDER rungs too, once the body has dropped back down', () => {
    // The expensive half. Selection only drops after a body has shrunk well
    // past what it holds, so an 8192 left behind is 179 MB the screen cannot
    // show — and because the body is still drawn every frame, the eviction
    // pass would never reclaim it on its own.
    expect(otherRungs([1024, 8192], 1024)).toEqual([8192]);
    expect(otherRungs([2048, 4096, 8192], 2048)).toEqual([4096, 8192]);
  });

  it('leaves a body holding exactly the one rung it draws', () => {
    expect(otherRungs([4096], 4096)).toEqual([]);
  });
});

describe('the layer actually applies all of this', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../planet-mesh-layer.ts', import.meta.url)),
    'utf8',
  );

  it('enforces the budget every frame and frees superseded rungs on promotion', () => {
    expect(src).toContain('this.enforceTextureBudget();');
    expect(src).toContain('this.releaseOtherRungs(planet, want);');
  });

  it('closes the decoded bitmap as well as the GL object', () => {
    // Texture.dispose frees the GL texture; the ImageBitmap behind it is ours
    // to close, and leaking those leaks CPU memory the GPU budget never sees.
    expect(src).toContain('(state.tex.image as ImageBitmap).close();');
  });

  it('drops the drawn-rung record when a colour rung is evicted', () => {
    // Otherwise the body keeps claiming a rung it no longer holds and renders
    // its placeholder until it happens to grow into a new one.
    expect(src).toContain('this.shownRung.delete(');
  });

  it('stamps relief and ring maps as used, not just the colour map', () => {
    // Eviction keys on last use, so every DRAW-path lookup has to go through
    // useTexture; a raw Map lookup there would look permanently stale and be
    // evicted out from under a drawn body. Residency checks are the deliberate
    // exception and have their own helper.
    expect(src).not.toContain('this.textures.get(textureKey(');
    expect(src).toContain('this.useTexture(textureKey(planet.name, RELIEF_SUFFIX))');
    expect(src).toContain('this.useTexture(textureKey(planet.name, RINGS_SUFFIX))');
  });
});
