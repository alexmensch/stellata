// The GLSL chunks mirror numbers that also live in TypeScript. Nothing
// at compile time ties the two sides together, so pin them here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LUMA_WEIGHTS } from './tonemap-pure';
import { LUMA_CEIL } from './emission-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const tonemapChunk = read('./tonemap.glsl');
const emissionChunk = read('./emission.glsl');

function lumaWeights(chunk: string): number[] {
  const m = chunk.match(
    /const vec3 STELLATA_LUMA_WEIGHTS = vec3\(([^)]+)\);/,
  );
  if (m === null) throw new Error('STELLATA_LUMA_WEIGHTS not declared');
  return m[1].split(',').map((s) => Number(s.trim()));
}

describe('shared chunk constants', () => {
  it('both chunks declare the same Rec.709 luma weights as tonemap-pure', () => {
    expect(lumaWeights(tonemapChunk)).toEqual([...LUMA_WEIGHTS]);
    expect(lumaWeights(emissionChunk)).toEqual([...LUMA_WEIGHTS]);
  });

  it('emission.glsl clamps at the same ceiling as emission-pure', () => {
    const m = emissionChunk.match(/const float STELLATA_LUMA_CEIL = ([\d.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LUMA_CEIL);
  });
});

// Both chunks can land in one fragment stage from H4 on (a per-pixel
// magnitude needs the unit and the operator together), and three pastes
// every #include textually — so each declaration has to be guarded, and
// the two weight declarations have to share one guard.
describe('include guards', () => {
  const guarded = (chunk: string, macro: string) =>
    new RegExp(`#ifndef ${macro}\\s*\\n#define ${macro}`).test(chunk);

  it('guards each chunk against double inclusion', () => {
    expect(guarded(tonemapChunk, 'STELLATA_TONEMAP')).toBe(true);
    expect(guarded(emissionChunk, 'STELLATA_HDR_EMISSION')).toBe(true);
  });

  it('shares one guard for the duplicated luma-weight declaration', () => {
    for (const chunk of [tonemapChunk, emissionChunk]) {
      expect(guarded(chunk, 'STELLATA_LUMA_WEIGHTS_DECLARED')).toBe(true);
    }
  });

  it('closes every #ifndef it opens', () => {
    for (const chunk of [tonemapChunk, emissionChunk]) {
      const opens = chunk.match(/^#ifndef /gm)?.length ?? 0;
      const closes = chunk.match(/^#endif/gm)?.length ?? 0;
      expect(closes).toBe(opens);
    }
  });
});
