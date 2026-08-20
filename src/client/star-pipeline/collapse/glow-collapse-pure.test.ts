import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GLOW_COLLAPSE_FLOOR_L,
  GLOW_COLLAPSE_STACK_MARGIN,
  glowCollapseHalfStepL,
} from './glow-collapse-pure';
import { displayLevel, tonemapWhitePoint } from '../../hdr/tonemap-pure';

const vertSrc = () =>
  readFileSync(fileURLToPath(new URL('../star.vert.glsl', import.meta.url)), 'utf8');

describe('the collapse floor', () => {
  it('is the operator inverted at half an 8-bit step, margin under it', () => {
    const wp = tonemapWhitePoint();
    expect(displayLevel(glowCollapseHalfStepL(wp), wp)).toBeCloseTo(0.5 / 255, 12);
    expect(GLOW_COLLAPSE_FLOOR_L * GLOW_COLLAPSE_STACK_MARGIN).toBe(
      glowCollapseHalfStepL(),
    );
    expect(GLOW_COLLAPSE_FLOOR_L).toBeCloseTo(3.1399364e-4, 10);
  });

  it('is whitePoint-independent to first order, so DR_MAG cannot move it', () => {
    const lo = glowCollapseHalfStepL(tonemapWhitePoint(5.5));
    const hi = glowCollapseHalfStepL(tonemapWhitePoint(11));
    expect(Math.abs(hi - lo) / lo).toBeLessThan(1e-4);
  });
});

describe('the GLSL twin', () => {
  it('pins the shader literal against the derived constant', () => {
    const m = vertSrc().match(
      /STELLATA_GLOW_COLLAPSE_FLOOR_L = ([0-9.e+-]+);/,
    );
    expect(m).not.toBeNull();
    const literal = Number(m![1]);
    expect(Math.abs(literal - GLOW_COLLAPSE_FLOOR_L) / GLOW_COLLAPSE_FLOOR_L)
      .toBeLessThan(1e-6);
  });

  it('collapses the footprint before the flux renorm divides it', () => {
    const src = vertSrc();
    const collapse = src.indexOf('pxSize = uSizeMin;');
    const renorm = src.indexOf('vFluxPeakL = stellataKernelFluxPeak');
    expect(collapse).toBeGreaterThan(0);
    expect(renorm).toBeGreaterThan(collapse);
  });

  it('the taper cull and the fragment taper share one bound', () => {
    // Both stages anchor the glow band on uThresholdMag + 0.5 — the vertex
    // cull past it is exact only while the fragment taper ends there.
    const vert = vertSrc();
    const frag = readFileSync(
      fileURLToPath(new URL('../star.frag.glsl', import.meta.url)),
      'utf8',
    );
    expect(vert).toMatch(/appMag >= uThresholdMag \+ 0\.5/);
    expect(frag).toMatch(
      /smoothstep\(uThresholdMag, uThresholdMag \+ 0\.5, vAppMag\)/,
    );
  });
});
