// The disc / glow / core-mask discards are written as a partition over
// `vPhysRatio`, so the three compilations have to solve it from the same
// input. Only the glow one folds `iEclipseDim`, which means that input
// must be the UNDIMMED apparent magnitude on both backends —
// ./README.md § Star rendering.
//
// Nothing downstream can catch a regression here. `colourPassFor` is the
// single CPU mirror and takes size terms that are already resolved, so it
// agrees with itself whatever the shaders do; reverting either shader
// leaves every other suite green. The invariant lives in the shader
// sources and has to be pinned there.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Source with comments stripped — a prose mention of a token must not
 *  satisfy (or defeat) a claim about what the code does. */
const code = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const glsl = code('./star.vert.glsl');
const tsl = code('../webgpu/star/star-vertex-tsl.ts');

/** Offset of the first match, asserted present. */
function at(src: string, needle: RegExp, label: string): number {
  const m = src.match(needle);
  if (m?.index === undefined) throw new Error(`${label}: no match for ${needle}`);
  return m.index;
}

describe('star.vert.glsl routes the pass split on the undimmed magnitude', () => {
  it('captures appMagRoute ahead of the eclipse fold', () => {
    // Captured, not reconstructed: subtracting the dim back off afterwards
    // does not round-trip in float32, so the glow compilation would route
    // on a value the other two never compute.
    expect(at(glsl, /float appMagRoute = appMag;/, 'capture'))
      .toBeLessThan(at(glsl, /appMag \+= -2\.5 \* log\(iEclipseDim\)/, 'fold'));
  });

  it('never lets the dim reach appMagRoute', () => {
    expect(glsl).not.toMatch(/appMagRoute[^;\n]*iEclipseDim/);
  });

  it('adds the dust extinction to both, so they differ by the dim alone', () => {
    expect(glsl).toMatch(/appMag \+= absorbAV;\s*\n\s*appMagRoute \+= absorbAV;/);
  });

  it('solves routeAppSize from appMagRoute, and vPhysRatio from routeAppSize', () => {
    expect(glsl).toMatch(/routeAppSize[\s\S]{0,200}perceptualDmEff\(appMagRoute,/);
    expect(glsl).toMatch(/vPhysRatio = clamp\(physSize \/ max\(max\(routeAppSize, physSize\)/);
  });

  it('skips the re-solve when no dim is on the star', () => {
    expect(glsl).toMatch(/float routeAppSize = eclipseDimmed\s*\n\s*\?/);
    expect(glsl).toMatch(/:\s*appSize;/);
  });
});

describe('star-vertex-tsl.ts mirrors that routing', () => {
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

  it('skips the re-solve when no dim is on the star, as the GLSL ternary does', () => {
    expect(tsl).toMatch(
      /If\(eclipseDim\.lessThan\(1\.0\), \(\) => \{\s*\n\s*routeAppSize\.assign\(/);
  });
});
