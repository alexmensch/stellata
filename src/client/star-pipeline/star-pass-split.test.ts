// The vertex stage must route the disc/glow split on the undimmed
// magnitude, or the three compilations tier a star differently and every
// one of them discards it. ./README.md § Star rendering.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Source with comments stripped — a prose mention of a token must not
 *  satisfy (or defeat) a claim about what the code does. */
const code = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const tsl = code('../webgpu/star/star-vertex-tsl.ts');

/** Offset of the first match, asserted present. */
function at(src: string, needle: RegExp, label: string): number {
  const m = src.match(needle);
  if (m?.index === undefined) throw new Error(`${label}: no match for ${needle}`);
  return m.index;
}

describe('star-vertex-tsl.ts routes on the undimmed magnitude', () => {
  it('captures appMagRoute ahead of the eclipse fold', () => {
    expect(at(tsl, /appMagRoute\.assign\(appMag\);/, 'capture'))
      .toBeLessThan(at(tsl, /appMag\.addAssign\(log\(eclipseDim\)/, 'fold'));
  });

  it('never lets the dim reach appMagRoute', () => {
    expect(tsl).not.toMatch(/appMagRoute[^;\n]*eclipseDim\b/);
  });

  it('adds the dust extinction to both, so they differ by the dim alone', () => {
    expect(tsl).toMatch(/appMag\.addAssign\(absorbAV\);\s*\n\s*appMagRoute\.addAssign\(absorbAV\);/);
  });

  it('solves routeAppSize from appMagRoute, and physRatio from routeAppSize', () => {
    expect(tsl).toMatch(/routeAppSize\.assign\([\s\S]{0,200}perceptualDmEffTsl\(\s*\n?\s*appMagRoute,/);
    expect(tsl).toMatch(/physRatio\.assign\(\s*\n?\s*clamp\(physSize\.div\(max\(max\(routeAppSize, physSize\)/);
  });

  it('skips the re-solve when no dim is on the star', () => {
    expect(tsl).toMatch(
      /If\(eclipseDim\.lessThan\(1\.0\), \(\) => \{\s*\n\s*routeAppSize\.assign\(/);
  });
});
