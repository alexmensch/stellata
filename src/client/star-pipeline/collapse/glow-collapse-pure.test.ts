import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GLOW_COLLAPSE_FLOOR_L,
  GLOW_COLLAPSE_STACK_MARGIN,
  glowCollapseHalfStepL,
} from './glow-collapse-pure';
import { displayLevel, tonemapWhitePoint } from '../../hdr/tonemap/tonemap-pure';
import { pointSourcePeakLuminance } from '../../hdr/emission/emission-pure';
import {
  EV_MAX_STOPS, sceneExposure, thresholdMagFor,
} from '../../hdr/exposure/exposure-epoch';
import { emitterPutsInkOnScreen, taperFactor } from '../../hdr/exposure/emitter-visibility-pure';
import { SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';

const src = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const vertSrc = () => src('../star.vert.glsl');
const fragSrc = () => src('../star.frag.glsl');

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

  it('the taper cull and the fragment taper share one named bound', () => {
    // The vertex cull past the band's end is exact only while the fragment
    // taper ends there. A literal on either side lets the two drift apart
    // without failing anything, and lets either drift from the TypeScript
    // the WebGPU stages import — hence the no-literal assertions.
    expect(vertSrc()).toMatch(
      /appMag >= uThresholdMag \+ STELLATA_SOFT_TAPER_MARGIN_MAG/,
    );
    expect(fragSrc()).toMatch(
      /uThresholdMag \+ STELLATA_SOFT_TAPER_MARGIN_MAG, vAppMag\)/,
    );
    expect(vertSrc()).not.toMatch(/uThresholdMag \+ 0\.5/);
    expect(fragSrc()).not.toMatch(/uThresholdMag \+ 0\.5/);
  });

  it('tests the taper bound once, before the extinction read', () => {
    // The read is the dominant vertex cost on the fallback path, and A_V
    // only ever dims — so the prefilter call is what keeps it off the
    // culled population, and the post-extinction call is the exact one.
    const vert = vertSrc();
    const calls = [...vert.matchAll(/starTaperDead\(appMag\)/g)];
    expect(calls).toHaveLength(2);
    expect(calls[0]!.index).toBeLessThan(vert.indexOf('absorbAV = '));
    expect(calls[1]!.index).toBeGreaterThan(vert.indexOf('appMag += absorbAV;'));
  });
});

describe('the collapse floor against the pick path', () => {
  // collapse/README.md's claim that no collapsed star is pickable. The two
  // predicates do NOT compare the same quantity — the collapse tests
  // vPeakL·tap², emitterPeakDisplayLevel tests peak·tap — so the
  // implication holds only for tap ≥ 1/GLOW_COLLAPSE_STACK_MARGIN. What
  // supplies that is the peak's own ceiling: it caps the pickable band at
  // ~0.31 mag past threshold, while tap falls under 1/16 only past ~0.42.
  it('is never reached by a star the pick path still calls visible', () => {
    const whitePoint = tonemapWhitePoint();
    const limitMag = 7.8;
    let collapsed = 0;
    for (const ev of [0, EV_MAX_STOPS, -EV_MAX_STOPS]) {
      for (const dm of [0, -0.5, -1, -2, -3, -5, -8, -12]) {
        const exposure = sceneExposure(limitMag, dm, ev);
        const thresholdMag = thresholdMagFor(limitMag, ev);
        for (let over = 0; over <= SOFT_TAPER_MARGIN_MAG; over += 0.002) {
          for (const physRadiusPx of [0.01, 0.1, 0.5, 0.56, 1, 2, 5]) {
            const appMag = thresholdMag + over;
            const tap = taperFactor(appMag, thresholdMag, true);
            const peak = pointSourcePeakLuminance(exposure, appMag, physRadiusPx);
            if (peak * tap * tap >= GLOW_COLLAPSE_FLOOR_L) continue;
            collapsed++;
            expect(emitterPutsInkOnScreen({
              appMag, exposure, thresholdMag, physRadiusPx, whitePoint, tapered: true,
            })).toBe(false);
          }
        }
      }
    }
    expect(collapsed).toBeGreaterThan(1000);
  });
});
